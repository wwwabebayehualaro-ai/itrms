"""What can be asked of the data of a form: queryable fields and their roles, derived from the template itself.

The form schema lives in `FormTemplate.form_config` (written by the builder), so this module is the single place that maps
a builder field type to a query kind and works out which field plays which part in a view (title, stage, date, measure...).
The frontend view modes consume `describe()`; the query endpoint enforces exactly the same list (`specs()`).
"""
from __future__ import annotations

import re
from typing import Any

from app.foundation.db.json_query import FieldSpec, KEY_RE
from app.modules.form_submission.models.FormSubmission import FormSubmission

TEXT_TYPES = {"InputText", "InputTextarea", "InputMask", "AutoComplete", "ColorPicker", "Editor"}
CHOICE_TYPES = {"Dropdown", "RadioButton", "SelectButton", "ListBox"}
MULTI_TYPES = {"MultiSelect", "CheckboxGroup", "Chips", "TreeSelect"}
NUMBER_TYPES = {"InputNumber", "Rating", "Knob", "Slider"}
BOOLEAN_TYPES = {"Checkbox", "InputSwitch", "ToggleButton"}
SKIPPED_TYPES = {"Password"}
DIRECTORY_URL = re.compile(r"/auth/directory\b")
STAGE_MAX_OPTIONS = 12


def _config(form_config: Any) -> dict:
    if isinstance(form_config, list):  # legacy templates stored the bare field list
        return {"fields": form_config}
    return form_config if isinstance(form_config, dict) else {}


def _prop(f: dict, key: str, default: Any = None) -> Any:
    props = f.get("props") or {}
    if key in props:
        return props[key]
    return ((f.get("data") or {}).get("defaultProps") or {}).get(key, default)


def _row_scoped(fields: list[dict]) -> set[str]:
    """Ids of fields that live inside a repeatable section (their values are rows, not top-level values)."""
    kids: dict[str, list[str]] = {}
    for f in fields:
        if f.get("parentId"):
            kids.setdefault(f["parentId"], []).append(f.get("id"))
    scoped: set[str] = set()
    stack = [f["id"] for f in fields if f.get("type") == "FormArray" and f.get("id")]
    while stack:
        for child in kids.get(stack.pop(), []):
            if child not in scoped:
                scoped.add(child)
                stack.append(child)
    return scoped


def _kind(f: dict) -> str | None:
    t = f.get("type")
    if t in SKIPPED_TYPES:
        return None
    if t in TEXT_TYPES:
        return "text"
    if t == "Dropdown" and _prop(f, "multiple"):
        return "multi"
    if t in CHOICE_TYPES:
        return "choice"
    if t in MULTI_TYPES:
        return "multi"
    if t == "Slider":
        return None if _prop(f, "range") else "number"
    if t in NUMBER_TYPES:
        return "number"
    if t in BOOLEAN_TYPES:
        return "boolean"
    if t == "Calendar":
        return "datetime" if _prop(f, "showTime") else "date"
    if t == "FileUpload":
        return "files"
    if t == "FormArray":
        return "rows"
    return None


def _static_options(f: dict) -> list[dict]:
    raw = ((f.get("data") or {}).get("dataSource") or {}).get("staticData") or _prop(f, "options") or []
    out = []
    for o in raw if isinstance(raw, list) else []:
        if isinstance(o, dict) and o.get("value") not in (None, ""):
            out.append({"value": o["value"], "label": o.get("label", o["value"])})
        elif isinstance(o, str) and o:
            out.append({"value": o, "label": o})
    return out


def _binding_url(f: dict, runtime: dict) -> str | None:
    ds_id = ((f.get("data") or {}).get("optionsBinding") or {}).get("dataSourceId")
    for ds in runtime.get("dataSources") or []:
        if ds.get("id") == ds_id:
            return ((ds.get("request") or {}).get("url")) or ""
    return None


def restrictions(form_config: Any) -> dict[str, frozenset[str]]:
    """Top-level fields that only some roles may see: field id -> roles allowed (`visibleToRoles` in the template).
    Fields inside a repeatable section cannot be restricted on their own (restrict the section instead)."""
    cfg = _config(form_config)
    fields = [f for f in (cfg.get("fields") or []) if isinstance(f, dict) and f.get("id")]
    scoped = _row_scoped(fields)
    out: dict[str, frozenset[str]] = {}
    for f in fields:
        roles = f.get("visibleToRoles")
        if f["id"] not in scoped and isinstance(roles, list) and roles:
            out[str(f["id"])] = frozenset(str(r) for r in roles)
    return out


def field_ids(form_config: Any) -> set[str]:
    return {str(f["id"]) for f in (_config(form_config).get("fields") or []) if isinstance(f, dict) and f.get("id")}


def hidden_keys(current: Any | None, older: list[Any], roles: frozenset[str]) -> frozenset[str]:
    """The keys of submission data this caller may not see. `admin` sees everything.
    The current form decides for the fields it has; a field that has since been removed from the form stays hidden if any
    earlier version of the form restricted it (the data is still stored)."""
    if "admin" in roles:
        return frozenset()
    hidden = {k for k, allowed in (restrictions(current) if current is not None else {}).items() if not (allowed & roles)}
    present = field_ids(current) if current is not None else set()
    for cfg in older:
        hidden |= {k for k, allowed in restrictions(cfg).items() if k not in present and not (allowed & roles)}
    return frozenset(hidden)


def strip_fields(form_config: Any, hidden: frozenset[str]) -> Any:
    """The form without the fields the caller may not see."""
    if not hidden:
        return form_config
    if isinstance(form_config, list):
        return [f for f in form_config if not (isinstance(f, dict) and f.get("id") in hidden)]
    if isinstance(form_config, dict) and isinstance(form_config.get("fields"), list):
        return {**form_config, "fields": [f for f in form_config["fields"] if not (isinstance(f, dict) and f.get("id") in hidden)]}
    return form_config


def value_fields(form_config: Any, hidden: frozenset[str] = frozenset()) -> list[dict]:
    """Top-level value fields of a template as dicts: id, label, kind, options, required, bound_to_directory."""
    cfg = _config(form_config)
    fields = [f for f in (cfg.get("fields") or []) if isinstance(f, dict) and f.get("id")]
    scoped = _row_scoped(fields)
    runtime = cfg.get("runtime") or {}
    out = []
    for f in fields:
        if f["id"] in scoped or f["id"] in hidden or not KEY_RE.match(str(f["id"])):
            continue
        kind = _kind(f)
        if kind is None:
            continue
        url = _binding_url(f, runtime)
        person = kind == "choice" and bool(url and DIRECTORY_URL.search(url))
        out.append({
            "id": f["id"], "label": f.get("label") or f["id"], "kind": "person" if person else kind,
            "type": f.get("type"), "options": _static_options(f) if kind in ("choice", "multi") else [],
            "bound": bool(url), "required": bool(_prop(f, "required")), "currency": _prop(f, "currency") if _prop(f, "mode") == "currency" else None,
        })
    return out


def builtin_specs() -> list[FieldSpec]:
    return [
        FieldSpec("status", "choice", "Status", FormSubmission.status),
        FieldSpec("created_at", "datetime", "Submitted", FormSubmission.created_at),
        FieldSpec("updated_at", "datetime", "Updated", FormSubmission.updated_at),
        FieldSpec("submitted_by", "person", "Submitted by", FormSubmission.submitted_by),
    ]


BUILTIN_KEYS = frozenset(s.key for s in builtin_specs())


def specs(form_config: Any, hidden: frozenset[str] = frozenset()) -> list[FieldSpec]:
    """Everything the query endpoint accepts. Template fields can never shadow a built-in key. Hidden fields are not
    queryable at all (filtering, sorting, searching or grouping by a field would reveal its values)."""
    out = builtin_specs()
    for f in value_fields(form_config, hidden):
        if f["id"] in BUILTIN_KEYS:
            continue
        # a directory-bound dropdown stores user ids as strings in the document: plain text equality, shown as a person
        out.append(FieldSpec(f["id"], "choice" if f["kind"] == "person" else f["kind"], f["label"]))
    return out


def roles(fields: list[dict]) -> dict[str, Any]:
    """Which field plays which part in a view. A view mode is offered only when the roles it needs exist."""
    text = [f for f in fields if f["kind"] == "text"]
    choices = [f for f in fields if f["kind"] == "choice" and (f["bound"] or 2 <= len(f["options"]) <= STAGE_MAX_OPTIONS)]
    stage = next((f for f in choices if f["options"]), None)
    dates = [f for f in fields if f["kind"] in ("date", "datetime")]
    title = next((f for f in text if f["required"]), None) or (text[0] if text else None)
    sub = next((f for f in fields if f["id"] != (title or {}).get("id") and f["kind"] in ("text", "person", "choice")), None)
    measures = sorted((f for f in fields if f["kind"] == "number"), key=lambda f: 0 if f["currency"] else 1)
    return {
        "title": title and title["id"], "subtitle": sub and sub["id"],
        "stage": stage["id"] if stage else "status",  # the built-in status is always there to fall back on
        "date": dates[0]["id"] if dates else None, "dateEnd": dates[1]["id"] if len(dates) > 1 else None,
        "measures": [f["id"] for f in measures],
        "people": [f["id"] for f in fields if f["kind"] == "person"] + ["submitted_by"],
        "files": [f["id"] for f in fields if f["kind"] == "files"],
        "rows": [f["id"] for f in fields if f["kind"] == "rows"],
    }


def describe(form_config: Any, hidden: frozenset[str] = frozenset()) -> dict[str, Any]:
    """The view schema sent to the frontend: fields with what each supports, the roles, and the view modes that make sense."""
    fields = value_fields(form_config, hidden)
    r = roles(fields)
    spec_by_key = {s.key: s for s in builtin_specs()}
    described = [{"key": s.key, "label": s.label, "kind": s.kind, "person": s.kind == "person", "builtin": True, "ops": list(s.ops), "sortable": s.sortable, "groupable": s.groupable, "aggregatable": s.aggregatable, "options": []} for s in spec_by_key.values()]
    for f in fields:
        if f["id"] in BUILTIN_KEYS:
            continue
        s = FieldSpec(f["id"], "choice" if f["kind"] == "person" else f["kind"], f["label"])
        described.append({"key": s.key, "label": s.label, "kind": s.kind, "person": f["kind"] == "person", "builtin": False, "ops": list(s.ops), "sortable": s.sortable, "groupable": s.groupable, "aggregatable": s.aggregatable,
                          "options": f["options"], "currency": f["currency"], "type": f["type"]})
    # table, cards, board (the built-in status is always a usable stage), pivot and dashboard (counts need no measure) work for any form
    modes = ["table", "cards", "board"] + (["calendar"] if r["date"] else []) + ["pivot", "dashboard"]
    return {"fields": described, "roles": r, "modes": modes}
