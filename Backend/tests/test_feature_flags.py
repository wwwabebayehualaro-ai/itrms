"""Module registry and feature flags: menu by permission, per-tenant switches, guarded routers, dependencies, admin only."""
from tests.conftest import PASSWORD, _login
from tests.test_platform_core import audit_rows


async def _user(client, admin_h, email, role):
    r = await client.post("/auth/users", headers=admin_h, json={"email": email, "password": PASSWORD, "roles": [role]})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {(await _login(client, email))['access_token']}"}


def _labels(nav):
    out = set()

    def walk(items):
        for i in items:
            out.add(i["label"])
            walk(i["children"])

    for g in nav:
        out.add(g["title"])
        walk(g["items"])
    return out


async def test_modules_menu_follows_permissions(client, acme):
    admin = (await client.get("/platform/modules", headers=acme["h"])).json()
    assert {m["key"] for m in admin["modules"]} >= {"platform", "form_builder", "form_submission", "files"}
    assert [g["title"] for g in admin["nav"]][:4] == ["Work", "Template Builder", "Submitted Forms", "Form Initiator"]
    assert {"Administration", "Feature flags", "Drag and Drop", "Templates"} <= _labels(admin["nav"])
    slot = next(i for g in admin["nav"] for i in g["items"] if i["slot"] == "form-templates")
    assert slot["label"] == "Templates"
    assert admin["flags"]["module.form_builder"] is True and admin["flags"]["module.platform"] is True

    submitter = await _user(client, acme["h"], "sub@acme-corp.org", "submitter")
    labels = _labels((await client.get("/platform/modules", headers=submitter)).json()["nav"])
    assert "Manage Templates" in labels and "Templates Pool" in labels
    assert not {"Administration", "Feature flags", "Drag and Drop", "Code Editor"} & labels


async def test_switching_a_module_off_guards_its_api_per_tenant(client, db, acme, globex):
    assert (await client.get("/form/submissions", headers=acme["h"])).status_code == 200
    r = await client.put("/platform/flags/module.form_submission", headers=acme["h"], json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["overridden"] is True

    off = await client.get("/form/submissions", headers=acme["h"])
    assert off.status_code == 404 and off.json()["code"] == "feature_disabled"
    menu = (await client.get("/platform/modules", headers=acme["h"])).json()
    assert "form_submission" not in {m["key"] for m in menu["modules"]} and "Submitted Forms" not in _labels(menu["nav"])
    # another tenant is not affected
    assert (await client.get("/form/submissions", headers=globex["h"])).status_code == 200
    # the change is audited
    assert [a.action for a in await audit_rows(db, resource_type="feature_flags")] == ["create"]

    reset = await client.put("/platform/flags/module.form_submission", headers=acme["h"], json={"enabled": None})
    assert reset.json() == {**reset.json(), "enabled": True, "overridden": False}
    assert (await client.get("/form/submissions", headers=acme["h"])).status_code == 200


async def test_a_module_is_off_when_a_module_it_depends_on_is_off(client, acme):
    await client.put("/platform/flags/module.files", headers=acme["h"], json={"enabled": False})
    flags = (await client.get("/platform/modules", headers=acme["h"])).json()["flags"]
    assert flags["module.files"] is False and flags["module.form_submission"] is False and flags["module.form_builder"] is True
    assert (await client.get("/form/submissions", headers=acme["h"])).json()["code"] == "feature_disabled"


async def test_flag_administration_is_admin_only_and_validated(client, acme):
    editor = await _user(client, acme["h"], "ed@acme-corp.org", "editor")
    assert (await client.get("/platform/flags", headers=editor)).status_code == 403
    assert (await client.put("/platform/flags/module.files", headers=editor, json={"enabled": False})).status_code == 403
    assert (await client.get("/platform/modules", headers=editor)).status_code == 200

    flags = {f["key"]: f for f in (await client.get("/platform/flags", headers=acme["h"])).json()}
    assert flags["module.platform"]["locked"] and not flags["module.files"]["locked"]
    unknown = await client.put("/platform/flags/nope", headers=acme["h"], json={"enabled": True})
    assert unknown.status_code == 404 and unknown.json()["code"] == "unknown_flag"
    locked = await client.put("/platform/flags/module.platform", headers=acme["h"], json={"enabled": False})
    assert locked.status_code == 409 and locked.json()["code"] == "flag_locked"
