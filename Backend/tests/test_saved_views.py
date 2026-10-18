"""Saved views: private/shared/default, permissions, tenant isolation, bounded config."""
import pytest

from tests.conftest import PASSWORD, _login

CONFIG = {"mode": "board", "search": "x", "filter": {"op": "and", "items": [{"field": "status", "op": "eq", "value": "submitted"}]}, "sort": [{"field": "created_at", "desc": True}], "columns": ["a", "b"], "page_size": 20, "options": {"month": "2026-10"}}


async def _template(client, h):
    return (await client.post("/template/forms/templates", headers=h, json={"name": "Req", "form_config": {"fields": [{"id": "title", "type": "InputText"}]}, "file_relations": []})).json()["id"]


async def _user(client, admin_h, email, role):
    r = await client.post("/auth/users", headers=admin_h, json={"email": email, "password": PASSWORD, "full_name": email.split("@")[0].title(), "roles": [role]})
    assert r.status_code == 201, r.text
    tokens = await _login(client, email)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def post(client, h, tid, **over):
    return await client.post("/form/views", headers=h, json={"template_id": tid, "name": "Mine", "config": CONFIG, **over})


@pytest.mark.asyncio
async def test_private_views_belong_to_their_owner(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    editor = await _user(client, h, "ed@acme-corp.org", "editor")
    submitter = await _user(client, h, "sub@acme-corp.org", "submitter")
    mine = (await post(client, submitter, tid, name="My open items")).json()
    assert mine["visibility"] == "private" and mine["can_edit"] and mine["owner_name"] and mine["config"]["mode"] == "board"
    # nobody else sees it, not even an editor or the admin, and they cannot reach it by id
    for other in (editor, h):
        assert [v["id"] for v in (await client.get("/form/views", headers=other, params={"template_id": tid})).json()] == []
        assert (await client.patch(f"/form/views/{mine['id']}", headers=other, json={"name": "x"})).status_code == 404
        assert (await client.delete(f"/form/views/{mine['id']}", headers=other)).status_code == 404
    renamed = await client.patch(f"/form/views/{mine['id']}", headers=submitter, json={"name": "Renamed", "config": {**CONFIG, "mode": "table"}})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed" and renamed.json()["config"]["mode"] == "table"
    assert (await client.delete(f"/form/views/{mine['id']}", headers=submitter)).status_code == 204
    assert (await client.get("/form/views", headers=submitter, params={"template_id": tid})).json() == []


@pytest.mark.asyncio
async def test_sharing_and_default_need_template_edit_rights(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    submitter = await _user(client, h, "sub@acme-corp.org", "submitter")
    viewer = await _user(client, h, "vw@acme-corp.org", "viewer")
    assert (await post(client, submitter, tid, visibility="shared")).status_code == 403
    assert (await post(client, submitter, tid, is_default=True)).status_code == 403
    assert (await post(client, viewer, tid)).status_code == 403  # read-only role cannot create views
    mine = (await post(client, submitter, tid)).json()
    assert (await client.patch(f"/form/views/{mine['id']}", headers=submitter, json={"visibility": "shared"})).status_code == 403

    shared = (await post(client, h, tid, name="Pending", visibility="shared")).json()
    assert shared["visibility"] == "shared"
    for who in (submitter, viewer):
        listed = (await client.get("/form/views", headers=who, params={"template_id": tid})).json()
        assert [v["name"] for v in listed if v["visibility"] == "shared"] == ["Pending"]
    own = next(v for v in (await client.get("/form/views", headers=submitter, params={"template_id": tid})).json() if v["id"] == shared["id"])
    assert own["can_edit"] is False  # visible, not editable
    assert (await client.patch(f"/form/views/{shared['id']}", headers=submitter, json={"name": "x"})).status_code == 403
    assert (await client.delete(f"/form/views/{shared['id']}", headers=submitter)).status_code == 403


@pytest.mark.asyncio
async def test_one_default_per_form(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    a = (await post(client, h, tid, name="A", is_default=True)).json()
    assert a["is_default"] and a["visibility"] == "shared"
    b = (await post(client, h, tid, name="B", is_default=True)).json()
    views = {v["name"]: v for v in (await client.get("/form/views", headers=h, params={"template_id": tid})).json()}
    assert views["B"]["is_default"] and not views["A"]["is_default"]
    again = (await client.patch(f"/form/views/{a['id']}", headers=h, json={"is_default": True})).json()
    views = {v["name"]: v for v in (await client.get("/form/views", headers=h, params={"template_id": tid})).json()}
    assert again["is_default"] and views["A"]["is_default"] and not views["B"]["is_default"]
    unshared = (await client.patch(f"/form/views/{a['id']}", headers=h, json={"visibility": "private"})).json()
    assert unshared["visibility"] == "private" and unshared["is_default"] is False  # a private view cannot be the default


@pytest.mark.asyncio
async def test_views_are_tenant_isolated_and_config_is_bounded(client, acme, globex):
    h = acme["h"]
    tid = await _template(client, h)
    v = (await post(client, h, tid, visibility="shared")).json()
    assert (await client.get("/form/views", headers=globex["h"], params={"template_id": tid})).status_code == 404
    assert (await client.patch(f"/form/views/{v['id']}", headers=globex["h"], json={"name": "x"})).status_code == 404
    assert (await post(client, globex["h"], tid)).status_code == 404
    bad = [
        {"mode": "Not A Mode"}, {"search": "x" * 101}, {"page_size": 0}, {"page_size": 101}, {"columns": ["c"] * 51}, {"columns": ["c" * 65]},
        {"sort": [{"field": "a"}] * 4}, {"options": {"x": "y" * 5000}},
        {"filter": {"op": "and", "items": [{"field": "a", "op": "eq", "value": i} for i in range(51)]}},
        {"filter": {"op": "and", "items": [{"field": "a", "op": "bogus", "value": 1}]}},
    ]
    for over in bad:
        r = await post(client, h, tid, config={**CONFIG, **over})
        assert r.status_code == 422, (over, r.status_code)
    assert (await post(client, h, tid, name="   ")).status_code == 422
    assert (await client.post("/form/views", json={})).status_code == 401
