"""A saved form must be a form the engine can read: the contract (contracts/form-config.schema.json, generated from the
frontend's Zod schemas and field kit) plus the structure (unique keys, existing parents, no loops)."""
import pytest

from app.foundation.errors import ValidationFailed
from app.modules.form_builder.services.form_config import _validator, check_form_config
from tests.conftest import TEMPLATE

F = lambda id, type, **kw: {"id": id, "type": type, "props": {}, **kw}  # noqa: E731


def errors_of(config):
    with pytest.raises(ValidationFailed) as e:
        check_form_config(config)
    assert e.value.code == "invalid_form_config"
    return {x["field"]: x["message"] for x in e.value.errors}


def test_the_contract_is_found_and_valid():
    assert _validator() is not None


def test_valid_forms_pass_also_in_older_shapes():
    check_form_config({"schemaVersion": 2, "fields": [F("box", "Panel", layout={"options": {"isContainer": True}}), F("name", "InputText", parentId="box", anything={"old": "keys"})], "runtime": {"dataSources": []}})
    check_form_config([F("name", "InputText")])  # the oldest format: a bare list
    check_form_config({"fields": []})


def test_unknown_types_and_bad_shapes_are_named():
    e = errors_of({"fields": [F("a", "TabView"), {"type": "InputText"}], "runtime": {"dataSources": [{"id": "1bad", "request": {"method": "GET", "url": "/x"}}]}})
    assert e["form_config.fields[0].type"] == '"TabView" is not a field type this version knows'
    assert "form_config.fields[1]" in e  # no id
    assert "form_config.runtime.dataSources[0].id" in e
    assert errors_of({"fields": "nope"})


def test_structure_keys_parents_loops():
    e = errors_of({"fields": [F("a", "InputText"), F("a", "InputText"), F("x", "InputText", parentId="gone"), F("p", "Panel", parentId="q"), F("q", "Panel", parentId="p")]})
    assert e["form_config.fields[1].id"].startswith('The key "a" is used by field 1')
    assert e["form_config.fields[2].parentId"] == '"x" sits in "gone", which is not a field of this form'
    assert "loop" in e["form_config.fields[3].parentId"]


async def test_the_api_refuses_an_invalid_form_and_keeps_metadata_updates_working(client, acme):
    h = acme["h"]
    bad = await client.post("/template/forms/templates", headers=h, json={**TEMPLATE, "slug": "bad-form", "form_config": {"fields": [F("a", "Nope")]}})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_form_config"
    assert bad.json()["errors"][0]["field"] == "form_config.fields[0].type"

    t = (await client.post("/template/forms/templates", headers=h, json=TEMPLATE)).json()
    r = await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"form_config": {"fields": [F("a", "InputText"), F("a", "InputText")]}})
    assert r.status_code == 422
    # settings only (no form_config): not checked, nothing to check
    ok = await client.put(f"/template/forms/templates/{t['id']}", headers=h, json={"name": "Renamed"})
    assert ok.status_code == 200 and ok.json()["name"] == "Renamed"
