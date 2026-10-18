"""Idempotency-Key: a retried command returns the first result instead of acting twice."""
from datetime import timedelta

from sqlalchemy import select, update

from app.foundation import context
from app.foundation.idempotency import purge_expired
from app.foundation.idempotency.model import IdempotencyRecord
from tests.conftest import PASSWORD, TEMPLATE, _login


async def _template(client, h):
    return (await client.post("/template/forms/templates", headers=h, json=TEMPLATE)).json()["id"]


async def _count(client, h, tid):
    return (await client.get("/form/submissions", headers=h, params={"template_id": tid})).json()["total"]


async def test_a_retried_submit_creates_one_request(client, acme):
    h, tid = acme["h"], await _template(client, acme["h"])
    body = {"template_id": tid, "submission_data": {"name": "Ada"}}
    first = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "k-1"}, json=body)
    again = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "k-1"}, json=body)
    assert first.status_code == again.status_code == 201
    assert again.json()["id"] == first.json()["id"] and again.headers.get("Idempotent-Replayed") == "true"
    assert "Idempotent-Replayed" not in first.headers
    assert await _count(client, h, tid) == 1

    reused = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "k-1"}, json={**body, "submission_data": {"name": "Bob"}})
    assert reused.status_code == 422 and reused.json()["code"] == "idempotency_key_reused"

    # without a key every call acts
    await client.post("/form/submissions", headers=h, json=body)
    await client.post("/form/submissions", headers=h, json=body)
    assert await _count(client, h, tid) == 3


async def test_keys_belong_to_one_user_and_failures_are_not_stored(client, acme):
    h, tid = acme["h"], await _template(client, acme["h"])
    r = await client.post("/auth/users", headers=h, json={"email": "sub@acme-corp.org", "password": PASSWORD, "roles": ["submitter"]})
    assert r.status_code == 201
    other = {"Authorization": f"Bearer {(await _login(client, 'sub@acme-corp.org'))['access_token']}"}
    body = {"template_id": tid, "submission_data": {}}
    a = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "same"}, json=body)
    b = await client.post("/form/submissions", headers={**other, "Idempotency-Key": "same"}, json=body)
    assert a.status_code == b.status_code == 201 and a.json()["id"] != b.json()["id"]

    missing = {"template_id": "3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a3b", "submission_data": {}}
    for _ in range(2):  # the failure is not replayed: the call runs (and fails) again
        failed = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "fails"}, json=missing)
        assert failed.status_code == 404 and "Idempotent-Replayed" not in failed.headers, failed.text

    bad = await client.post("/form/submissions", headers={**h, "Idempotency-Key": "has space"}, json=body)
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_idempotency_key"


async def test_expired_records_are_purged(client, db, acme):
    h, tid = acme["h"], await _template(client, acme["h"])
    await client.post("/form/submissions", headers={**h, "Idempotency-Key": "old"}, json={"template_id": tid, "submission_data": {}})
    with context.system_context():
        async with db.sessionmaker() as s:
            await s.execute(update(IdempotencyRecord).values(expires_at=IdempotencyRecord.expires_at - timedelta(days=2)))
            await s.commit()
    assert await purge_expired() == 1
    with context.system_context():
        async with db.sessionmaker() as s:
            assert (await s.execute(select(IdempotencyRecord))).scalars().all() == []
