"""Maker-checker approvals: who may decide, never the maker, effects in the decision's transaction, audit, isolation."""
import uuid

import pytest

from app.foundation import context
from app.foundation.approval import register_policy
from app.foundation.approval.service import ApprovalService
from app.foundation.errors import Conflict
from app.foundation.security import permissions
from tests.conftest import PASSWORD, _login
from tests.test_platform_core import audit_rows

permissions.register("widget", ["approve"])
permissions.define_role("widget_approver", ["widget:approve"])

effects: list[tuple[str, str]] = []


async def _approved(session, request):
    if (request.payload or {}).get("fail"):
        raise Conflict("The widget changed meanwhile", code="widget_changed")
    effects.append(("approved", request.resource_id))


async def _rejected(session, request):
    effects.append(("rejected", request.resource_id))


register_policy("widget.publish", title="Publish a widget", approver_permission="widget:approve", on_approved=_approved, on_rejected=_rejected)


async def _user(client, admin_h, email, role):
    r = await client.post("/auth/users", headers=admin_h, json={"email": email, "password": PASSWORD, "roles": [role]})
    assert r.status_code == 201, r.text
    return {"id": uuid.UUID(r.json()["id"]), "h": {"Authorization": f"Bearer {(await _login(client, email))['access_token']}"}}


async def _open(db, tenant_id, maker_id, resource_id="w1", **kw):
    async with db.sessionmaker() as s:
        with context.as_actor(tenant_id, maker_id):
            request = await ApprovalService(s).submit("widget.publish", resource_type="widgets", resource_id=resource_id, title=f"Publish {resource_id}", **kw)
            await s.commit()
            return str(request.id)


@pytest.fixture
def people(client, acme):
    async def make():
        return {
            "maker": await _user(client, acme["h"], "maker@acme-corp.org", "submitter"),
            "checker": await _user(client, acme["h"], "checker@acme-corp.org", "widget_approver"),
            "bystander": await _user(client, acme["h"], "editor@acme-corp.org", "editor"),
        }
    return make


async def test_maker_cannot_decide_a_checker_approves_once(client, db, acme, people):
    p = await people()
    effects.clear()
    rid = await _open(db, acme["tenant"].id, p["maker"]["id"], note="Ready for launch", payload={"version": 2})

    mine = (await client.get("/platform/approvals", headers=p["maker"]["h"], params={"scope": "mine"})).json()
    assert [i["id"] for i in mine["items"]] == [rid] and mine["items"][0]["can_cancel"] and not mine["items"][0]["can_decide"]
    assert (await client.get("/platform/approvals", headers=p["maker"]["h"])).json()["items"] == []  # nothing to decide for the maker

    own = await client.post(f"/platform/approvals/{rid}/approve", headers=p["maker"]["h"], json={})
    assert own.status_code == 403 and own.json()["code"] == "self_approval"

    inbox = (await client.get("/platform/approvals", headers=p["checker"]["h"])).json()
    item = inbox["items"][0]
    assert item["id"] == rid and item["can_decide"] and item["requested_by_name"] and item["policy_title"] == "Publish a widget"
    assert item["note"] == "Ready for launch" and item["payload"] == {"version": 2}

    ok = await client.post(f"/platform/approvals/{rid}/approve", headers=p["checker"]["h"], json={"comment": "Looks good", "row_version": item["row_version"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved" and ok.json()["decided_by"] == str(p["checker"]["id"]) and ok.json()["comment"] == "Looks good"
    assert effects == [("approved", "w1")]

    again = await client.post(f"/platform/approvals/{rid}/approve", headers=p["checker"]["h"], json={})
    assert again.status_code == 409 and again.json()["code"] == "approval_not_pending"
    assert effects == [("approved", "w1")]
    actions = [a.action for a in await audit_rows(db, resource_type="approval_requests")]
    assert "approval.requested" in actions and "approval.approved" in actions


async def test_people_without_the_permission_cannot_see_or_decide(client, db, acme, globex, people):
    p = await people()
    rid = await _open(db, acme["tenant"].id, p["maker"]["id"])
    for h in (p["bystander"]["h"], globex["h"]):  # an editor without widget:approve, another tenant's admin
        assert (await client.get(f"/platform/approvals/{rid}", headers=h)).status_code == 404
        assert (await client.post(f"/platform/approvals/{rid}/approve", headers=h, json={})).status_code == 404
    # the tenant admin holds approval:read (and widget:approve through "*")
    everything = (await client.get("/platform/approvals", headers=acme["h"], params={"scope": "all"})).json()
    assert [i["id"] for i in everything["items"]] == [rid]


async def test_reject_needs_a_reason_and_cancel_is_for_the_maker(client, db, acme, people):
    p = await people()
    effects.clear()
    r1 = await _open(db, acme["tenant"].id, p["maker"]["id"], resource_id="w1")
    missing = await client.post(f"/platform/approvals/{r1}/reject", headers=p["checker"]["h"], json={"comment": "  "})
    assert missing.status_code == 422 and missing.json()["errors"][0]["field"] == "comment"
    rejected = await client.post(f"/platform/approvals/{r1}/reject", headers=p["checker"]["h"], json={"comment": "Wrong colour"})
    assert rejected.json()["status"] == "rejected" and effects == [("rejected", "w1")]

    r2 = await _open(db, acme["tenant"].id, p["maker"]["id"], resource_id="w1")  # a closed request does not block a new one
    assert (await client.post(f"/platform/approvals/{r2}/cancel", headers=p["checker"]["h"], json={})).status_code == 403
    withdrawn = await client.post(f"/platform/approvals/{r2}/cancel", headers=p["maker"]["h"], json={})
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "cancelled"


async def test_one_open_request_per_resource_and_a_failing_effect_saves_nothing(client, db, acme, people):
    p = await people()
    effects.clear()
    rid = await _open(db, acme["tenant"].id, p["maker"]["id"], resource_id="w9", payload={"fail": True})
    with pytest.raises(Conflict):
        await _open(db, acme["tenant"].id, p["maker"]["id"], resource_id="w9")

    refused = await client.post(f"/platform/approvals/{rid}/approve", headers=p["checker"]["h"], json={})
    assert refused.status_code == 409 and refused.json()["code"] == "widget_changed"
    still = (await client.get(f"/platform/approvals/{rid}", headers=p["checker"]["h"])).json()
    assert still["status"] == "pending" and still["decided_by"] is None and effects == []
