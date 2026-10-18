"""Form publish workflow: without approvals every save is published (as before); with `forms.require_approval` a second person
must approve, and people keep filling in the published version meanwhile."""
from tests.conftest import PASSWORD, TEMPLATE, _login

V2 = {"fields": [{"id": "name", "type": "InputText"}, {"id": "email", "type": "InputText"}]}


async def _user(client, admin_h, email, role):
    r = await client.post("/auth/users", headers=admin_h, json={"email": email, "password": PASSWORD, "roles": [role]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {(await _login(client, email))['access_token']}"}


async def _create(client, h, **over):
    r = await client.post("/template/forms/templates", headers=h, json={**TEMPLATE, **over})
    assert r.status_code == 201, r.text
    return r.json()


async def _submit(client, h, tid, data=None):
    return await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": data or {"name": "Ada"}})


async def test_without_approvals_every_save_is_published(client, acme):
    h = acme["h"]
    t = await _create(client, h)
    assert t["status"] == "published" and t["published_version_id"] and t["published_at"]
    assert (await _submit(client, h, t["id"])).status_code == 201

    updated = (await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"form_config": V2})).json()
    assert updated["status"] == "published" and updated["published_version_id"] != t["published_version_id"]
    published = (await client.get(f"/template/forms/templates/{t['id']}/published", headers=h)).json()
    assert published["form_config"] == V2 and published["version_id"] == updated["published_version_id"]

    again = await client.post(f"/template/forms/templates/{t['id']}/publish", headers=h)
    assert again.status_code == 409 and again.json()["code"] == "nothing_to_publish"


async def test_with_approvals_a_second_person_publishes(client, acme):
    admin = acme["h"]
    assert (await client.put("/platform/flags/forms.require_approval", headers=admin, json={"enabled": True})).status_code == 200
    editor = await _user(client, admin, "ed@acme-corp.org", "editor")
    submitter = await _user(client, admin, "sub@acme-corp.org", "submitter")

    t = await _create(client, editor)
    assert t["status"] == "draft" and t["published_version_id"] is None
    blocked = await _submit(client, submitter, t["id"])
    assert blocked.status_code == 409 and blocked.json()["code"] == "form_not_published"
    assert (await client.get(f"/template/forms/templates/{t['id']}/published", headers=submitter)).json()["code"] == "form_not_published"
    assert (await client.post(f"/template/forms/templates/{t['id']}/publish", headers=submitter)).status_code == 403

    pending = await client.post(f"/template/forms/templates/{t['id']}/publish", headers=editor, json={"note": "First version"})
    assert pending.status_code == 200 and pending.json()["status"] == "pending_approval"
    twice = await client.post(f"/template/forms/templates/{t['id']}/publish", headers=editor)
    assert twice.status_code == 409 and twice.json()["code"] == "approval_pending"

    request = (await client.get("/platform/approvals", headers=admin)).json()["items"][0]
    assert request["policy"] == "template.publish" and request["resource_id"] == t["id"] and request["note"] == "First version"
    own = await client.post(f"/platform/approvals/{request['id']}/approve", headers=editor, json={})
    assert own.status_code == 403  # the editor asked: they cannot decide (self-approval, and no template:approve)
    assert (await client.post(f"/platform/approvals/{request['id']}/approve", headers=admin, json={})).json()["status"] == "approved"

    live = (await client.get(f"/template/forms/templates/{t['id']}", headers=editor)).json()
    assert live["status"] == "published" and live["published_version_id"] == request["payload"]["version_id"]
    first = await _submit(client, submitter, t["id"])
    assert first.status_code == 201

    # editing makes a draft; people keep filling in (and seeing) the published version
    draft = (await client.put(f"/template/forms/templates/{t['id']}", headers=editor, json={"form_config": V2})).json()
    assert draft["status"] == "draft" and draft["published_version_id"] == live["published_version_id"]
    assert (await client.get(f"/template/forms/templates/{t['id']}/published", headers=submitter)).json()["form_config"] == TEMPLATE["form_config"]
    second = (await _submit(client, submitter, t["id"])).json()
    record = (await client.get(f"/form/submissions/{second['id']}/form", headers=submitter)).json()
    assert record["form_config"] == TEMPLATE["form_config"] and record["current"] is True

    # a rejected publish leaves the published version in place
    await client.post(f"/template/forms/templates/{t['id']}/publish", headers=editor)
    nxt = (await client.get("/platform/approvals", headers=admin)).json()["items"][0]
    rejected = await client.post(f"/platform/approvals/{nxt['id']}/reject", headers=admin, json={"comment": "Email must be optional"})
    assert rejected.json()["status"] == "rejected"
    after = (await client.get(f"/template/forms/templates/{t['id']}", headers=editor)).json()
    assert after["status"] == "draft" and after["published_version_id"] == live["published_version_id"]


async def test_approving_a_deleted_form_is_refused(client, acme):
    admin = acme["h"]
    await client.put("/platform/flags/forms.require_approval", headers=admin, json={"enabled": True})
    editor = await _user(client, admin, "ed@acme-corp.org", "editor")
    t = await _create(client, editor)
    await client.post(f"/template/forms/templates/{t['id']}/publish", headers=editor)
    await client.delete(f"/template/forms/templates/{t['id']}", headers=admin)
    request = (await client.get("/platform/approvals", headers=admin)).json()["items"][0]
    refused = await client.post(f"/platform/approvals/{request['id']}/approve", headers=admin, json={})
    assert refused.status_code == 409 and refused.json()["code"] == "form_deleted"


async def test_my_requests_lists_only_what_i_submitted(client, acme):
    admin = acme["h"]
    t = await _create(client, admin)
    priya = await _user(client, admin, "priya.mine@acme-corp.org", "submitter")
    assert (await _submit(client, admin, t["id"], {"name": "Admin's"})).status_code == 201
    assert (await _submit(client, priya, t["id"], {"name": "Priya's"})).status_code == 201
    r = await client.get("/form/submissions?mine=true", headers=priya)
    assert r.status_code == 200, r.text
    mine = r.json()
    assert [s["submission_data"]["name"] for s in mine["items"]] == ["Priya's"]
    everyone = (await client.get(f"/form/submissions?template_id={t['id']}", headers=admin)).json()
    assert everyone["total"] == 2
