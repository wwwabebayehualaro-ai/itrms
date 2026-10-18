"""Errors, request context, observability, auth and authorization."""
import pytest
from sqlalchemy import select

from app.foundation.audit.model import AuditLog
from tests.conftest import PASSWORD, TEMPLATE, _login


async def audit_rows(db, **where):
    async with db.sessionmaker() as s:
        stmt = select(AuditLog).order_by(AuditLog.occurred_at)
        for k, v in where.items():
            stmt = stmt.where(getattr(AuditLog, k) == v)
        return (await s.execute(stmt)).scalars().all()


# ---------------------------------------------------------------- errors
async def test_unknown_route_is_problem_json(client):
    r = await client.get("/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["code"] == "http_404" and body["trace_id"] == r.headers["x-request-id"]


async def test_unhandled_error_never_leaks_internals(client):
    r = await client.get("/__boom")
    assert r.status_code == 500
    assert "secret-internal-detail" not in r.text
    body = r.json()
    assert body["code"] == "internal_error" and body["trace_id"] == r.headers["x-request-id"]


async def test_validation_errors_list_fields(client, acme):
    r = await client.post("/auth/users", headers=acme["h"], json={"email": "not-an-email", "password": "x"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error" and any(e["field"] == "email" for e in body["errors"])


async def test_unauthenticated_is_401_with_challenge(client):
    r = await client.get("/template/forms/templates")
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
    assert r.json()["code"] == "not_authenticated"


# ---------------------------------------------------------------- request context / observability
async def test_request_id_propagation_and_security_headers(client):
    r = await client.get("/healthz", headers={"X-Request-ID": "trace-abc-12345"})
    assert r.headers["x-request-id"] == "trace-abc-12345"
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"
    bad = await client.get("/healthz", headers={"X-Request-ID": "bad id\r\n"})
    assert bad.headers["x-request-id"] != "bad id"


async def test_health_ready_and_metrics(client, db):
    assert (await client.get("/healthz")).json() == {"status": "ok"}
    assert (await client.get("/readyz")).json()["checks"]["database"] == "ok"
    await client.get("/nope")
    m = await client.get("/metrics")
    assert m.status_code == 200 and "http_requests_total" in m.text


async def test_body_size_limit(client, acme):
    r = await client.post("/auth/login", content=b"x", headers={"content-length": str(50 * 1024 * 1024), "content-type": "application/json"})
    assert r.status_code == 413


# ---------------------------------------------------------------- authentication
async def test_login_failure_is_uniform_and_audited(client, db, acme):
    wrong = await client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": "wrong-password"})
    ghost = await client.post("/auth/login", json={"email": "nobody@acme-corp.org", "password": "wrong-password"})
    assert wrong.status_code == ghost.status_code == 401
    assert wrong.json()["detail"] == ghost.json()["detail"]
    rows = await audit_rows(db, action="auth.login", outcome="failure")
    assert len(rows) == 2 and rows[0].changes["reason"] == "bad_credentials"


async def test_account_locks_after_repeated_failures(client, acme, monkeypatch):
    for _ in range(5):
        await client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": "wrong-password"})
    r = await client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": PASSWORD})
    assert r.status_code == 401  # correct password refused while locked


async def test_refresh_rotates_and_detects_reuse(client, acme):
    first = acme["tokens"]["refresh_token"]
    second = (await client.post("/auth/refresh", json={"refresh_token": first})).json()
    assert second["refresh_token"] != first
    replay = await client.post("/auth/refresh", json={"refresh_token": first})
    assert replay.status_code == 401
    # the replay revoked the whole family, including the legitimately rotated token
    assert (await client.post("/auth/refresh", json={"refresh_token": second["refresh_token"]})).status_code == 401


async def test_access_token_cannot_be_used_as_refresh_and_vice_versa(client, acme):
    assert (await client.post("/auth/refresh", json={"refresh_token": acme["tokens"]["access_token"]})).status_code == 401
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {acme['tokens']['refresh_token']}"})
    assert r.status_code == 401


async def test_logout_revokes_session(client, acme):
    rt = acme["tokens"]["refresh_token"]
    assert (await client.post("/auth/logout", json={"refresh_token": rt})).status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": rt})).status_code == 401


async def test_tampered_token_rejected(client, acme):
    tok = acme["tokens"]["access_token"]
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {tok[:-4]}AAAA"})
    assert r.status_code == 401


async def test_password_change_revokes_sessions_and_enforces_policy(client, acme):
    h = acme["h"]
    weak = await client.post("/auth/password", headers=h, json={"current_password": PASSWORD, "new_password": "short"})
    assert weak.status_code == 422 and weak.json()["code"] == "weak_password"
    ok = await client.post("/auth/password", headers=h, json={"current_password": PASSWORD, "new_password": "An0ther-Strong-Pass"})
    assert ok.status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": acme["tokens"]["refresh_token"]})).status_code == 401
    assert (await client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": "An0ther-Strong-Pass"})).status_code == 200


# ---------------------------------------------------------------- authorization
async def _user_token(client, admin, email, roles):
    r = await client.post("/auth/users", headers=admin["h"], json={"email": email, "password": PASSWORD, "roles": roles})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {(await _login(client, email))['access_token']}"}


async def test_viewer_can_read_but_not_write_and_denial_is_audited(client, db, acme):
    viewer = await _user_token(client, acme, "viewer@acme-corp.org", ["viewer"])
    assert (await client.get("/template/forms/templates", headers=viewer)).status_code == 200
    denied = await client.post("/template/forms/templates", headers=viewer, json=TEMPLATE)
    assert denied.status_code == 403 and denied.json()["code"] == "forbidden"
    rows = await audit_rows(db, action="authz.denied")
    assert len(rows) == 1 and rows[0].resource_id == "template:create" and rows[0].outcome == "denied"


async def test_submitter_role_defined_by_feature(client, acme):
    admin_h = acme["h"]
    tid = (await client.post("/template/forms/templates", headers=admin_h, json=TEMPLATE)).json()["id"]
    sub = await _user_token(client, acme, "sub@acme-corp.org", ["submitter"])
    assert (await client.post("/form/submissions", headers=sub, json={"template_id": tid, "submission_data": {"a": 1}})).status_code == 201
    assert (await client.post("/template/forms/templates", headers=sub, json=TEMPLATE)).status_code == 403
    assert (await client.get("/auth/users", headers=sub)).status_code == 403


async def test_me_lists_effective_permissions_so_a_ui_can_hide_what_is_not_allowed(client, acme):
    admin = (await client.get("/auth/me", headers=acme["h"])).json()["permissions"]
    assert "submission:delete" in admin and "user:read" in admin and admin == sorted(admin)
    sub_h = await _user_token(client, acme, "sub2@acme-corp.org", ["submitter"])
    sub = (await client.get("/auth/me", headers=sub_h)).json()["permissions"]
    assert {"submission:create", "submission:read", "submission:update", "template:read", "directory:read"} <= set(sub)
    assert "submission:delete" not in sub and "template:create" not in sub and "user:read" not in sub
    editor_h = await _user_token(client, acme, "ed@acme-corp.org", ["editor"])
    editor = (await client.get("/auth/me", headers=editor_h)).json()["permissions"]
    assert "template:create" in editor and "submission:delete" not in editor and "user:read" not in editor  # sensitive resources stay out of wildcards


async def test_only_admin_manages_users_and_roles_are_validated(client, acme):
    bad = await client.post("/auth/users", headers=acme["h"], json={"email": "x@acme-corp.org", "password": PASSWORD, "roles": ["wizard"]})
    assert bad.status_code == 422 and bad.json()["code"] == "unknown_role"
    dup = await client.post("/auth/users", headers=acme["h"], json={"email": "admin@acme-corp.org", "password": PASSWORD, "roles": ["viewer"]})
    assert dup.status_code == 409


async def test_directory_is_a_tenant_scoped_people_picker_for_every_role(client, acme, globex):
    viewer = await _user_token(client, acme, "sarah.lee@acme-corp.org", ["viewer"])
    await client.post("/auth/users", headers=acme["h"], json={"email": "bob.stone@acme-corp.org", "password": PASSWORD, "full_name": "Bob Stone", "roles": ["submitter"]})
    sub = {"Authorization": f"Bearer {(await _login(client, 'bob.stone@acme-corp.org'))['access_token']}"}
    for who in (viewer, sub):  # users:read is admin-only, the directory is not
        r = await client.get("/auth/directory", headers=who)
        assert r.status_code == 200
        emails = [e["email"] for e in r.json()]
        assert "bob.stone@acme-corp.org" in emails and "admin@globex-corp.org" not in emails  # own tenant only
        assert set(r.json()[0]) == {"id", "email", "full_name"}  # no roles / flags leak
        assert (await client.get("/auth/users", headers=who)).status_code == 403
    found = (await client.get("/auth/directory", headers=viewer, params={"q": "stone"})).json()
    assert [e["full_name"] for e in found] == ["Bob Stone"]
    assert (await client.get("/auth/directory")).status_code == 401


async def test_wildcard_read_does_not_expose_user_administration(client, acme):
    for role in ("viewer", "editor"):
        who = await _user_token(client, acme, f"{role}@acme-corp.org", [role])
        assert (await client.get("/auth/users", headers=who)).status_code == 403
        assert (await client.get("/template/forms/templates", headers=who)).status_code == 200  # ordinary reads still work
    assert (await client.get("/auth/users", headers=acme["h"])).status_code == 200  # admin (global *) still can


async def test_simultaneous_logins_of_one_user_all_succeed(client, acme):
    """Login bookkeeping (last login, failed attempts) must not collide on the user's optimistic lock."""
    import asyncio

    results = await asyncio.gather(*(client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": PASSWORD}) for _ in range(5)))
    assert [r.status_code for r in results] == [200] * 5, [r.text for r in results if r.status_code != 200]


async def test_failed_attempts_are_counted_atomically_and_lock_the_account(client, acme):
    import asyncio

    from app.foundation.config import get_settings

    attempts = get_settings().login_max_failures
    bad = await asyncio.gather(*(client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": "wrong-Passw0rd!"}) for _ in range(attempts)))
    assert all(r.status_code == 401 for r in bad)
    # every failure was counted, so the account is now locked even for the right password
    assert (await client.post("/auth/login", json={"email": "admin@acme-corp.org", "password": PASSWORD})).status_code == 401
