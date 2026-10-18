"""Tenant isolation, audit trail, platform data features and the migrated feature endpoints."""
import uuid

import pytest
from sqlalchemy import select, text, update

from app.foundation.auth.models import User
from app.foundation import context
from app.foundation.audit.model import AuditLog
from app.foundation.errors import Forbidden
from app.modules.form_builder.models.FormTemplate import FormTemplate
from tests.conftest import PASSWORD, TEMPLATE

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def make_template(client, who, **over):
    r = await client.post("/template/forms/templates", headers=who["h"], json={**TEMPLATE, **over})
    assert r.status_code == 201, r.text
    return r.json()


async def audit(db, **where):
    async with db.sessionmaker() as s:
        stmt = select(AuditLog).order_by(AuditLog.occurred_at)
        for k, v in where.items():
            stmt = stmt.where(getattr(AuditLog, k) == v)
        return (await s.execute(stmt)).scalars().all()


# ------------------------------------------------------------------ tenant isolation
async def test_tenants_cannot_see_or_touch_each_others_data(client, acme, globex):
    t = await make_template(client, acme)
    tid = t["id"]
    assert (await client.get(f"/template/forms/templates/{tid}", headers=globex["h"])).status_code == 404
    assert (await client.put(f"/template/forms/templates/{tid}", headers=globex["h"], json={"name": "hijack"})).status_code == 404
    assert (await client.delete(f"/template/forms/templates/{tid}", headers=globex["h"])).status_code == 404
    assert (await client.get("/template/forms/templates", headers=globex["h"])).json() == []
    assert len((await client.get("/template/forms/templates", headers=acme["h"])).json()) == 1
    # untouched
    assert (await client.get(f"/template/forms/templates/{tid}", headers=acme["h"])).json()["name"] == "Customer Intake"


async def test_slug_unique_per_tenant_not_globally(client, acme, globex):
    await make_template(client, acme)
    assert (await client.post("/template/forms/templates", headers=acme["h"], json=TEMPLATE)).status_code == 409
    assert (await client.post("/template/forms/templates", headers=globex["h"], json=TEMPLATE)).status_code == 201


async def test_submission_against_foreign_template_is_404(client, acme, globex):
    t = await make_template(client, acme)
    r = await client.post("/form/submissions", headers=globex["h"], json={"template_id": t["id"], "submission_data": {}})
    assert r.status_code == 404


async def test_users_and_audit_are_tenant_scoped(client, acme, globex):
    users = (await client.get("/auth/users", headers=acme["h"])).json()
    assert [u["email"] for u in users["items"]] == ["admin@acme-corp.org"]


async def test_session_guard_fails_closed_without_tenant_context(db, client, acme):
    """Even raw ORM access (no repository) cannot read tenant data without a tenant, nor another tenant's."""
    await make_template(client, acme)
    async with db.sessionmaker() as s:
        assert (await s.execute(select(FormTemplate))).scalars().all() == []            # no tenant in context
    with context.as_actor(uuid.uuid4(), None):
        async with db.sessionmaker() as s:
            assert (await s.execute(select(FormTemplate))).scalars().all() == []        # someone else's tenant
    with context.as_actor(acme["tenant"].id, None):
        async with db.sessionmaker() as s:
            assert len((await s.execute(select(FormTemplate))).scalars().all()) == 1    # own tenant
    with context.system_context():
        async with db.sessionmaker() as s:
            assert len((await s.execute(select(FormTemplate))).scalars().all()) == 1    # explicit system bypass


async def test_bulk_update_is_tenant_filtered_too(db, client, acme, globex):
    await make_template(client, acme)
    with context.as_actor(globex["tenant"].id, None):
        async with db.sessionmaker() as s:
            await s.execute(update(FormTemplate).values(name="pwned"))
            await s.commit()
    assert (await client.get("/template/forms/templates", headers=acme["h"])).json()[0]["name"] == "Customer Intake"


async def test_cross_tenant_write_rejected_and_tenant_required(db, acme, globex):
    with context.as_actor(acme["tenant"].id, acme["user"].id):
        async with db.sessionmaker() as s:
            s.add(FormTemplate(name="x", slug="x", form_config={}, file_relations=[], tenant_id=globex["tenant"].id))
            with pytest.raises(Forbidden):
                await s.commit()
    async with db.sessionmaker() as s:  # no tenant context at all
        s.add(FormTemplate(name="x", slug="x", form_config={}, file_relations=[]))
        with pytest.raises(Forbidden):
            await s.commit()


# ------------------------------------------------------------------ audit trail
async def test_create_update_delete_are_audited_with_actor_and_request(client, db, acme):
    t = await make_template(client, acme)
    await client.put(f"/template/forms/templates/{t['id']}", headers=acme["h"], json={"name": "Renamed"})
    await client.delete(f"/template/forms/templates/{t['id']}", headers=acme["h"])
    rows = await audit(db, resource_type="form_templates", resource_id=t["id"])
    assert [r.action for r in rows] == ["create", "update", "delete"]
    for r in rows:
        assert r.actor_id == acme["user"].id and r.tenant_id == acme["tenant"].id and r.request_id
    assert rows[1].changes["name"] == {"old": "Customer Intake", "new": "Renamed"}
    assert rows[0].changes["name"]["new"] == "Customer Intake"


async def test_secrets_never_reach_the_audit_log(client, db, acme):
    rows = await audit(db, resource_type="users", action="create")
    blob = str([r.changes for r in rows])
    assert "password_hash" in blob and "argon2" not in blob and PASSWORD not in blob


async def test_audit_log_is_immutable_through_the_orm(db, acme):
    async with db.sessionmaker() as s:
        row = (await s.execute(select(AuditLog).limit(1))).scalars().first()
        row.action = "tampered"
        with pytest.raises(Forbidden):
            await s.commit()
    async with db.sessionmaker() as s:
        row = (await s.execute(select(AuditLog).limit(1))).scalars().first()
        await s.delete(row)
        with pytest.raises(Forbidden):
            await s.commit()


async def test_noisy_login_bookkeeping_is_not_audited_as_user_updates(client, db, acme):
    updates = await audit(db, resource_type="users", action="update")
    assert updates == []  # last_login_at / failed_attempts are ignored columns


# ------------------------------------------------------------------ platform data features
async def test_soft_delete_hides_but_keeps_row(client, db, acme):
    t = await make_template(client, acme)
    assert (await client.delete(f"/template/forms/templates/{t['id']}", headers=acme["h"])).status_code == 204
    assert (await client.get(f"/template/forms/templates/{t['id']}", headers=acme["h"])).status_code == 404
    with context.system_context():
        async with db.sessionmaker() as s:
            row = (await s.execute(select(FormTemplate))).scalars().one()
            assert row.deleted_at is not None and row.deleted_by == acme["user"].id
    # the freed slug can be reused
    assert (await client.post("/template/forms/templates", headers=acme["h"], json=TEMPLATE)).status_code == 201


async def test_optimistic_locking_returns_409(client, acme):
    t = await make_template(client, acme)
    ok = await client.put(f"/template/forms/templates/{t['id']}", headers=acme["h"], json={"name": "v2", "row_version": t["row_version"]})
    assert ok.status_code == 200 and ok.json()["row_version"] == t["row_version"] + 1
    stale = await client.put(f"/template/forms/templates/{t['id']}", headers=acme["h"], json={"name": "v3", "row_version": t["row_version"]})
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"


async def test_pagination_and_sort_whitelist(client, acme):
    tid = (await make_template(client, acme))["id"]
    for i in range(3):
        await client.post("/form/submissions", headers=acme["h"], json={"template_id": tid, "submission_data": {"i": i}})
    page = (await client.get("/form/submissions", headers=acme["h"], params={"page": 2, "page_size": 2})).json()
    assert page["total"] == 3 and page["page"] == 2 and len(page["items"]) == 1
    assert (await client.get("/form/submissions", headers=acme["h"], params={"page_size": 1000})).status_code == 422
    asc = (await client.get("/form/submissions", headers=acme["h"], params={"sort": "created_at"})).json()["items"]
    desc = (await client.get("/form/submissions", headers=acme["h"], params={"sort": "-created_at"})).json()["items"]
    assert [i["id"] for i in asc] == [i["id"] for i in reversed(desc)]
    assert (await client.get("/form/submissions", headers=acme["h"], params={"sort": "submission_data"})).status_code == 400  # not whitelisted


# ------------------------------------------------------------------ migrated features keep their contracts
async def test_template_builder_envelope_and_slug_generation(client, acme):
    r = await client.post("/template/forms/templates", headers=acme["h"], json={"template_data": {**TEMPLATE, "name": "Onboarding Form 2026"}})
    assert r.status_code == 201 and r.json()["slug"] == "onboarding-form-2026"
    assert "X-Total-Count" in (await client.get("/template/forms/templates", headers=acme["h"])).headers


async def test_submission_identity_comes_from_token_not_body(client, acme):
    tid = (await make_template(client, acme))["id"]
    r = await client.post("/form/submissions", headers=acme["h"], json={"template_id": tid, "submission_data": {"a": 1}, "submitted_by": str(uuid.uuid4()), "form_metadata": {"submitted_via": "web"}})
    assert r.status_code == 201 and r.json()["submitted_by"] == str(acme["user"].id)


async def test_submission_lifecycle(client, acme):
    tid = (await make_template(client, acme))["id"]
    draft = (await client.post("/form/submissions/drafts", headers=acme["h"], json={"template_id": tid})).json()
    assert draft["status"] == "draft"
    patched = await client.patch(f"/form/submissions/{draft['id']}/status", headers=acme["h"], json={"status": "submitted"})
    assert patched.json()["status"] == "submitted"
    assert (await client.patch(f"/form/submissions/{draft['id']}/status", headers=acme["h"], json={"status": "bogus"})).status_code == 422
    listed = (await client.get("/form/submissions", headers=acme["h"], params={"template_id": tid, "status": "submitted"})).json()
    assert listed["total"] == 1 and listed["items"][0]["is_deleted"] is False
    assert (await client.delete(f"/form/submissions/{draft['id']}", headers=acme["h"])).status_code == 204
    assert (await client.get(f"/form/submissions/{draft['id']}", headers=acme["h"])).status_code == 404


# ------------------------------------------------------------------ files
async def upload(client, who, content=PNG, name="pic.png", ctype="image/png"):
    return await client.post("/files/upload", headers=who["h"], files={"file": (name, content, ctype)})


async def test_file_upload_download_delete_and_tenant_isolation(client, acme, globex):
    r = await upload(client, acme, name='we"ird\r\n../name.png')
    assert r.status_code == 201, r.text
    body = r.json()
    assert "/" not in body["filename"] and "\n" not in body["filename"] and body["size"] == len(PNG)
    fid = body["file_id"]
    dl = await client.get(f"/files/upload/{fid}/download", headers=acme["h"])
    assert dl.status_code == 200 and dl.content == PNG and "attachment" in dl.headers["content-disposition"]
    prev = await client.get(f"/files/upload/{fid}/preview", headers=acme["h"])
    assert prev.headers["content-security-policy"].startswith("sandbox")
    assert (await client.get(f"/files/upload/{fid}", headers=globex["h"])).status_code == 404
    assert (await client.delete(f"/files/upload/{fid}", headers=globex["h"])).status_code == 404
    assert (await client.delete(f"/files/upload/{fid}", headers=acme["h"])).status_code == 204
    assert (await client.get(f"/files/upload/{fid}/download", headers=acme["h"])).status_code == 404


async def test_file_validation(client, acme, monkeypatch):
    assert (await upload(client, acme, content=b"<html>", name="x.html", ctype="text/html")).status_code == 415
    assert (await upload(client, acme, content=b"not really a png", ctype="image/png")).status_code == 415  # signature mismatch
    assert (await upload(client, acme, content=b"")).status_code in (400, 415)
    from app.foundation.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    assert (await upload(client, acme, content=PNG + b"0" * 200)).status_code == 413


async def test_failed_upload_leaves_no_orphan_bytes(client, acme):
    import os
    from app.foundation.config import get_settings

    await upload(client, acme, content=b"<html>", name="x.html", ctype="text/html")
    root = get_settings().upload_dir
    leftovers = [f for _, _, fs in os.walk(root) for f in fs] if os.path.exists(root) else []
    assert leftovers == []


async def test_viewer_cannot_upload(client, acme):
    r = await client.post("/auth/users", headers=acme["h"], json={"email": "v@acme-corp.org", "password": PASSWORD, "roles": ["viewer"]})
    assert r.status_code == 201
    tok = (await client.post("/auth/login", json={"email": "v@acme-corp.org", "password": PASSWORD})).json()["access_token"]
    assert (await upload(client, {"h": {"Authorization": f"Bearer {tok}"}})).status_code == 403
