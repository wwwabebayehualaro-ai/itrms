"""Record page API: the form version a request was filled in on, and who changed what."""
import pytest
from sqlalchemy import select, text

from app.modules.form_builder.models.TemplateVersion import TemplateVersion

V1 = [{"id": "title", "type": "InputText", "label": "Title"}]
V2 = [{"id": "title", "type": "InputText", "label": "Title"}, {"id": "cost", "type": "InputNumber", "label": "Cost"}]


async def _template(client, h, fields=V1):
    return (await client.post("/template/forms/templates", headers=h, json={"name": "Req", "form_config": {"fields": fields}, "file_relations": []})).json()


async def _submit(client, h, tid, data):
    r = await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": data})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_a_request_keeps_the_form_it_was_filled_in_on(client, acme, db):
    h = acme["h"]
    t = await _template(client, h)
    a = await _submit(client, h, t["id"], {"title": "first"})
    b = await _submit(client, h, t["id"], {"title": "second"})
    form = (await client.get(f"/form/submissions/{a['id']}/form", headers=h)).json()
    assert form["versioned"] and form["current"] and form["name"] == "Req" and [f["id"] for f in form["form_config"]["fields"]] == ["title"]
    from app.foundation import context
    with context.system_context():
        async with db.sessionmaker() as s:
            versions = (await s.execute(select(TemplateVersion))).scalars().all()
    assert len(versions) == 1  # identical content is stored once

    # the form changes: old requests still open with the old form, new ones get the new one
    upd = await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"form_config": {"fields": V2}, "row_version": t["row_version"]})
    assert upd.status_code == 200, upd.text
    old = (await client.get(f"/form/submissions/{a['id']}/form", headers=h)).json()
    assert [f["id"] for f in old["form_config"]["fields"]] == ["title"] and old["current"] is False
    c = await _submit(client, h, t["id"], {"title": "third", "cost": 5})
    new = (await client.get(f"/form/submissions/{c['id']}/form", headers=h)).json()
    assert [f["id"] for f in new["form_config"]["fields"]] == ["title", "cost"] and new["current"] is True

    # editing the data moves the request to the current form; a status change does not
    await client.patch(f"/form/submissions/{b['id']}/status", headers=h, json={"status": "processing"})
    assert (await client.get(f"/form/submissions/{b['id']}/form", headers=h)).json()["current"] is False
    assert (await client.patch(f"/form/submissions/{b['id']}", headers=h, json={"submission_data": {"title": "second", "cost": 9}})).status_code == 200
    assert (await client.get(f"/form/submissions/{b['id']}/form", headers=h)).json()["current"] is True


@pytest.mark.asyncio
async def test_requests_from_before_versions_use_the_current_form(client, acme, db):
    h = acme["h"]
    t = await _template(client, h)
    a = await _submit(client, h, t["id"], {"title": "old"})
    from app.foundation import context
    with context.system_context():
        async with db.sessionmaker() as s:
            await s.execute(text("UPDATE form_submissions SET template_version_id = NULL"))
            await s.commit()
    form = (await client.get(f"/form/submissions/{a['id']}/form", headers=h)).json()
    assert form["versioned"] is False and form["current"] is True


@pytest.mark.asyncio
async def test_history_lists_changes_per_field_newest_first(client, acme, globex):
    h = acme["h"]
    t = await _template(client, h)
    a = await _submit(client, h, t["id"], {"title": "v1", "note": "keep"})
    await client.patch(f"/form/submissions/{a['id']}", headers=h, json={"submission_data": {"title": "v2", "note": "keep", "extra": 1}})
    await client.patch(f"/form/submissions/{a['id']}/status", headers=h, json={"status": "completed"})
    hist = (await client.get(f"/form/submissions/{a['id']}/history", headers=h)).json()
    assert [e["action"] for e in hist] == ["update", "update", "create"]
    assert all(e["actor_name"] for e in hist)
    status = next(c for c in hist[0]["changes"] if c["field"] == "status")
    assert status == {"field": "status", "old": "submitted", "new": "completed"}
    fields = {c["field"]: c for c in hist[1]["changes"]}
    assert fields["title"] == {"field": "title", "old": "v1", "new": "v2"} and fields["extra"]["new"] == 1 and "note" not in fields  # unchanged keys are not listed
    # other tenants and deleted requests: 404
    assert (await client.get(f"/form/submissions/{a['id']}/history", headers=globex["h"])).status_code == 404
    assert (await client.get(f"/form/submissions/{a['id']}/form", headers=globex["h"])).status_code == 404
    await client.delete(f"/form/submissions/{a['id']}", headers=h)
    assert (await client.get(f"/form/submissions/{a['id']}/history", headers=h)).status_code == 404
