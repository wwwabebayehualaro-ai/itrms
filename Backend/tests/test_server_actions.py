"""Server actions: a form names coded work that runs on submit, in the request's transaction; processed requests are locked."""
from pydantic import BaseModel, Field

from app.foundation.errors import Conflict
from app.modules.form_submission.services.server_actions import ActionResult, get_action, register_server_action
from tests.conftest import PASSWORD, _login


class StampInput(BaseModel):
    name: str = Field(min_length=2)


async def _stamp(session, ctx) -> ActionResult:
    if ctx.input.name == "boom":
        raise Conflict("The other system said no", code="refused")
    return ActionResult(status="completed", data={"stamp": f"S-{ctx.input.name}"})


if get_action("tests.stamp") is None:
    register_server_action("tests.stamp", title="Stamp", permission="submission:create", input_model=StampInput, handler=_stamp)
    register_server_action("tests.flags_only", title="Flags only", permission="feature_flag:update", input_model=StampInput, handler=_stamp)


def _form(action="tests.stamp", fields=("name", "stamp")):
    return {"name": f"Stamped {action} {len(fields)}", "form_config": {"fields": [{"id": f, "type": "InputText"} for f in fields],
                                                                      "runtime": {"dataSources": [], "submit": {"serverAction": action}}}, "file_relations": []}


async def _template(client, h, **kw):
    r = await client.post("/template/forms/templates", headers=h, json=_form(**kw))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _submitter(client, admin_h):
    r = await client.post("/auth/users", headers=admin_h, json={"email": "filler@acme-corp.org", "password": PASSWORD, "roles": ["submitter"]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {(await _login(client, 'filler@acme-corp.org'))['access_token']}"}


async def test_the_builder_lists_actions_and_saving_checks_them(client, acme):
    h = acme["h"]
    listed = {a["key"]: a for a in (await client.get("/form/server-actions", headers=h)).json()}
    assert listed["tests.stamp"]["fields"] == [{"id": "name", "required": True, "description": None}]

    unknown = await client.post("/template/forms/templates", headers=h, json=_form(action="tests.nope"))
    assert unknown.status_code == 422 and "not a server action" in unknown.json()["errors"][0]["message"]
    missing = await client.post("/template/forms/templates", headers=h, json=_form(fields=("other",)))
    assert missing.status_code == 422 and "name" in missing.json()["errors"][0]["message"]


async def test_submit_runs_the_action_in_the_same_transaction(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    r = await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": {"name": "Ada"}, "form_metadata": {"server_action": "spoofed"}})
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["status"] == "completed" and sub["submission_data"] == {"name": "Ada", "stamp": "S-Ada"}
    assert sub["form_metadata"]["server_action"] == "tests.stamp"

    bad = await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": {"name": "A"}})
    assert bad.status_code == 422 and bad.json()["errors"][0]["field"] == "name"
    refused = await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": {"name": "boom"}})
    assert refused.status_code == 409 and refused.json()["code"] == "refused"
    assert (await client.get(f"/form/submissions?template_id={tid}", headers=h)).json()["total"] == 1  # nothing saved for the failures


async def test_processed_requests_are_locked(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    sid = (await client.post("/form/submissions", headers=h, json={"template_id": tid, "submission_data": {"name": "Ada"}})).json()["id"]
    for r in (await client.patch(f"/form/submissions/{sid}", headers=h, json={"submission_data": {"name": "Eve"}}),
              await client.patch(f"/form/submissions/{sid}/status", headers=h, json={"status": "failed"}),
              await client.delete(f"/form/submissions/{sid}", headers=h)):
        assert r.status_code == 409 and r.json()["code"] == "submission_locked"


async def test_a_draft_runs_the_action_when_it_is_submitted(client, acme):
    h = acme["h"]
    tid = await _template(client, h)
    draft = (await client.post("/form/submissions", headers=h, json={"template_id": tid, "status": "draft", "submission_data": {"name": "Ada"}})).json()
    assert draft["status"] == "draft" and "stamp" not in draft["submission_data"]
    assert (await client.patch(f"/form/submissions/{draft['id']}", headers=h, json={"submission_data": {"name": "Bob"}})).status_code == 200  # drafts stay editable
    sent = await client.patch(f"/form/submissions/{draft['id']}/status", headers=h, json={"status": "submitted"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "completed" and sent.json()["submission_data"]["stamp"] == "S-Bob"


async def test_the_action_needs_its_own_permission(client, acme):
    tid = await _template(client, acme["h"], action="tests.flags_only")
    submitter = await _submitter(client, acme["h"])
    r = await client.post("/form/submissions", headers=submitter, json={"template_id": tid, "submission_data": {"name": "Ada"}})
    assert r.status_code == 403
