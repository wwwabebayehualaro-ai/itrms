"""Field-level access: `visibleToRoles` on a form field hides its values from every other role on every path."""
import csv
import io

import pytest

from app.foundation.security import permissions
from app.modules.form_submission.services import submission_fields
from tests.test_saved_views import _user

permissions.define_role("hr", ["template:read", "submission:create", "submission:read", "submission:update", "submission:export", "file:read", "directory:read", "view:create", "view:read", "view:update"])

FIELDS = [
    {"id": "title", "type": "InputText", "label": "Title"},
    {"id": "ssn", "type": "InputText", "label": "SSN", "visibleToRoles": ["hr"]},
    {"id": "salary", "type": "InputNumber", "label": "Salary", "visibleToRoles": ["hr"]},
    {"id": "notes", "type": "InputText", "label": "Notes"},
    {"id": "lines", "type": "FormArray", "label": "Lines"},
    {"id": "qty", "type": "InputNumber", "label": "Qty", "parentId": "lines", "visibleToRoles": ["hr"]},  # inside a section: not restrictable on its own
]
SECRET = ("ssn", "salary")


async def setup(client, acme):
    h = acme["h"]
    people = {"admin": h, "hr": await _user(client, h, "hr@acme-corp.org", "hr")}
    for role in ("submitter", "editor", "viewer"):
        people[role] = await _user(client, h, f"{role}@acme-corp.org", role)
    t = (await client.post("/template/forms/templates", headers=h, json={"name": "Staff", "form_config": {"fields": FIELDS}, "file_relations": []})).json()
    rows = {}
    for who, data in (("hr", {"title": "A", "ssn": "123-45-6789", "salary": 5000, "notes": "n"}), ("admin", {"title": "B", "ssn": "987-65-4321", "salary": 9000}), ("submitter", {"title": "C", "ssn": "hack", "salary": 1})):
        r = await client.post("/form/submissions", headers=people[who], json={"template_id": t["id"], "submission_data": data})
        assert r.status_code == 201, r.text
        rows[data["title"]] = r.json()
    return people, t, rows


def seen(data):
    return {k for k in SECRET if k in (data or {})}


@pytest.mark.asyncio
async def test_restricted_values_are_hidden_on_every_response_path(client, acme):
    people, t, rows = await setup(client, acme)
    a, b, c = rows["A"], rows["B"], rows["C"]

    # the creator's own response is masked too, and a caller cannot store a value for a field they cannot see
    assert seen(c["submission_data"]) == set() and seen(a["submission_data"]) == set(SECRET) - set()
    for who in ("admin", "hr"):
        assert seen((await client.get(f"/form/submissions/{c['id']}", headers=people[who])).json()["submission_data"]) == set()  # C's "hack" was dropped on create
        for r in (a, b):
            assert seen((await client.get(f"/form/submissions/{r['id']}", headers=people[who])).json()["submission_data"]) == set(SECRET)

    for who in ("submitter", "editor", "viewer"):
        h = people[who]
        got = (await client.get(f"/form/submissions/{a['id']}", headers=h)).json()
        assert seen(got["submission_data"]) == set() and got["submission_data"]["title"] == "A" and got["submission_data"]["notes"] == "n"
        listed = (await client.get("/form/submissions", headers=h, params={"template_id": t["id"]})).json()["items"]
        assert len(listed) == 3 and all(seen(i["submission_data"]) == set() for i in listed)
        q = (await client.post("/form/submissions/query", headers=h, json={"template_id": t["id"]})).json()
        assert len(q["items"]) == 3 and all(seen(i["submission_data"]) == set() for i in q["items"])
        schema = (await client.get("/form/submissions/query/schema", headers=h, params={"template_id": t["id"]})).json()
        assert not {f["key"] for f in schema["fields"]} & set(SECRET) and schema["roles"]["measures"] == []
        form = (await client.get(f"/form/submissions/{a['id']}/form", headers=h)).json()
        assert not {f["id"] for f in form["form_config"]["fields"]} & set(SECRET) and "title" in {f["id"] for f in form["form_config"]["fields"]}
        hist = (await client.get(f"/form/submissions/{a['id']}/history", headers=h)).json()
        assert all(ch["field"] not in SECRET and "123-45" not in str(ch) and "5000" not in str(ch.get("new")) for e in hist for ch in e["changes"])

    # those who may see it do see it, everywhere
    q = (await client.post("/form/submissions/query", headers=people["hr"], json={"template_id": t["id"], "filter": {"items": [{"field": "salary", "op": "gt", "value": 4000}]}, "sort": [{"field": "salary", "desc": True}]})).json()
    assert [i["submission_data"]["title"] for i in q["items"]] == ["B", "A"]
    form = (await client.get(f"/form/submissions/{a['id']}/form", headers=people["hr"])).json()
    assert set(SECRET) <= {f["id"] for f in form["form_config"]["fields"]}
    hist = (await client.get(f"/form/submissions/{a['id']}/history", headers=people["hr"])).json()
    assert any(ch["field"] == "salary" for e in hist for ch in e["changes"])


@pytest.mark.asyncio
async def test_a_restricted_field_cannot_be_probed_through_queries(client, acme):
    people, t, rows = await setup(client, acme)
    h = people["editor"]
    probes = [
        {"filter": {"items": [{"field": "salary", "op": "gt", "value": 0}]}}, {"filter": {"items": [{"field": "ssn", "op": "contains", "value": "123"}]}},
        {"sort": [{"field": "salary"}]}, {"group_by": {"field": "ssn"}}, {"aggregates": [{"fn": "sum", "field": "salary"}]}, {"facets": ["ssn"]},
        {"filter": {"items": [{"field": "salary", "op": "empty"}]}},
    ]
    for body in probes:
        assert (await client.post("/form/submissions/query", headers=h, json={"template_id": t["id"], **body})).status_code == 400, body
    # free-text search never looks into a hidden field (the value 123-45-6789 only exists there)
    assert (await client.post("/form/submissions/query", headers=h, json={"template_id": t["id"], "search": "123-45-6789"})).json()["total"] == 0
    assert (await client.post("/form/submissions/query", headers=people["hr"], json={"template_id": t["id"], "search": "123-45-6789"})).json()["total"] == 1
    # the same probes work for those who may see the field
    ok = await client.post("/form/submissions/query", headers=people["hr"], json={"template_id": t["id"], "aggregates": [{"fn": "sum", "field": "salary"}]})
    assert ok.status_code == 200 and ok.json()["aggregates"]["sum_salary"] == 14000


@pytest.mark.asyncio
async def test_export_leaves_out_hidden_fields(client, acme):
    people, t, rows = await setup(client, acme)
    body = {"template_id": t["id"]}
    for who, has in (("editor", False), ("hr", True), ("admin", True)):
        csv_text = (await client.post("/form/submissions/export", headers=people[who], json=body)).content.decode("utf-8-sig")
        head = next(csv.reader(io.StringIO(csv_text)))
        assert (("SSN" in head) and ("Salary" in head)) is has and ("123-45-6789" in csv_text) is has, who
    assert (await client.post("/form/submissions/export", headers=people["editor"], json={**body, "fields": ["salary"]})).status_code == 400


@pytest.mark.asyncio
async def test_an_edit_by_someone_who_cannot_see_a_field_keeps_its_stored_value(client, acme):
    people, t, rows = await setup(client, acme)
    a = rows["A"]
    r = await client.patch(f"/form/submissions/{a['id']}", headers=people["submitter"], json={"submission_data": {"title": "A2", "notes": "x", "ssn": "HACKED", "salary": 1}})
    assert r.status_code == 200 and r.json()["submission_data"] == {"title": "A2", "notes": "x"}
    stored = (await client.get(f"/form/submissions/{a['id']}", headers=people["hr"])).json()["submission_data"]
    assert stored == {"title": "A2", "notes": "x", "ssn": "123-45-6789", "salary": 5000}  # theirs untouched, ours applied
    assert (await client.patch(f"/form/submissions/{a['id']}/status", headers=people["submitter"], json={"status": "completed"})).status_code == 200
    assert (await client.get(f"/form/submissions/{a['id']}", headers=people["hr"])).json()["submission_data"]["salary"] == 5000
    # HR editing replaces their own fields
    r = await client.patch(f"/form/submissions/{a['id']}", headers=people["hr"], json={"submission_data": {**stored, "salary": 5500}})
    assert r.json()["submission_data"]["salary"] == 5500


@pytest.mark.asyncio
async def test_changing_or_removing_the_restriction_follows_the_form(client, acme):
    people, t, rows = await setup(client, acme)
    h, a = acme["h"], rows["A"]
    cur = (await client.get(f"/template/forms/templates/{t['id']}", headers=h)).json()
    # lifting the restriction on salary shows it to everyone; ssn stays restricted
    lifted = [{k: v for k, v in f.items() if not (f["id"] == "salary" and k == "visibleToRoles")} for f in FIELDS]
    cur = (await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"form_config": {"fields": lifted}, "row_version": cur["row_version"]})).json()
    got = (await client.get(f"/form/submissions/{a['id']}", headers=people["viewer"])).json()["submission_data"]
    assert seen(got) == {"salary"}
    # removing the ssn field from the form does not expose the data that is still stored
    without = [f for f in lifted if f["id"] != "ssn"]
    await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"form_config": {"fields": without}, "row_version": cur["row_version"]})
    got = (await client.get(f"/form/submissions/{a['id']}", headers=people["viewer"])).json()["submission_data"]
    assert "ssn" not in got and "salary" in got
    assert "ssn" in (await client.get(f"/form/submissions/{a['id']}", headers=people["admin"])).json()["submission_data"]


def test_only_top_level_fields_can_be_restricted():
    r = submission_fields.restrictions({"fields": FIELDS})
    assert set(r) == {"ssn", "salary"} and r["ssn"] == frozenset({"hr"})  # `qty` is inside a repeatable section
    assert submission_fields.hidden_keys({"fields": FIELDS}, [], frozenset({"admin"})) == frozenset()
    assert submission_fields.hidden_keys({"fields": FIELDS}, [], frozenset()) == frozenset({"ssn", "salary"})  # unknown roles fail closed
    assert submission_fields.hidden_keys({"fields": FIELDS}, [], frozenset({"hr"})) == frozenset()


@pytest.mark.asyncio
async def test_role_names_are_available_to_form_editors_only(client, acme):
    people, t, rows = await setup(client, acme)
    listed = (await client.get("/auth/roles", headers=people["admin"])).json()
    assert {"admin", "editor", "viewer", "submitter", "hr"} <= set(listed)
    assert (await client.get("/auth/roles", headers=people["editor"])).status_code == 200  # editors build forms
    assert (await client.get("/auth/roles", headers=people["viewer"])).status_code == 403
    assert (await client.get("/auth/roles", headers=people["submitter"])).status_code == 403
