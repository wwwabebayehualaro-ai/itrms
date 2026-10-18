"""The stored form (`form_config`) is checked before it is saved.

Two layers:
* the contract `contracts/form-config.schema.json` (JSON Schema generated from the frontend engine's Zod schemas and its field
  kit, `npm run form:schema`): the document's shape, that every field type exists, the data sources' ids and methods;
* the structure, checked here: unique keys, parents that exist, no container inside itself.

Forms saved by older builders may carry more keys than the contract names: they are allowed. A bare list of fields (the oldest
format) is read as `{"fields": [...]}`.
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from jsonschema import Draft202012Validator

from app.foundation.errors import ValidationFailed

log = logging.getLogger(__name__)

#: Backend/app/modules/form_builder/services/form_config.py -> <repo>/contracts/form-config.schema.json
DEFAULT_SCHEMA_PATH = Path(__file__).resolve().parents[5] / "contracts" / "form-config.schema.json"
MAX_ERRORS = 20

#: further checks of a saved form contributed by other modules (e.g. that its server action exists), see `register_check`
_checks: list[Callable[[dict[str, Any]], list[dict[str, str]]]] = []


def register_check(check: Callable[[dict[str, Any]], list[dict[str, str]]]) -> None:
    """Add a check run on every saved form that passed the contract and structure checks; it returns errors ({field, message})."""
    _checks.append(check)


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator | None:
    path = Path(os.environ.get("FORM_CONFIG_SCHEMA_PATH") or DEFAULT_SCHEMA_PATH)
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        log.warning("form_config contract not found at %s: only the structure of saved forms is checked", path)
        return None
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _where(path: Any) -> str:
    out = "form_config"
    for p in path:
        out += f"[{p}]" if isinstance(p, int) else f".{p}"
    return out


def _structure(fields: list[Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    ids: dict[str, int] = {}
    for i, f in enumerate(fields):
        if not isinstance(f, dict):
            continue  # reported by the contract
        key = str(f.get("id", ""))
        if key in ids:
            errors.append({"field": f"form_config.fields[{i}].id", "message": f'The key "{key}" is used by field {ids[key] + 1} too'})
        else:
            ids[key] = i
    parent = {str(f.get("id")): (str(f["parentId"]) if f.get("parentId") not in (None, "") else None) for f in fields if isinstance(f, dict)}
    for i, f in enumerate(fields):
        if not isinstance(f, dict) or f.get("parentId") in (None, ""):
            continue
        key, p = str(f.get("id")), str(f["parentId"])
        if p not in ids:
            errors.append({"field": f"form_config.fields[{i}].parentId", "message": f'"{key}" sits in "{p}", which is not a field of this form'})
            continue
        seen, cur = {key}, p
        while cur is not None:
            if cur in seen:
                errors.append({"field": f"form_config.fields[{i}].parentId", "message": f'"{key}" is inside itself (its containers form a loop)'})
                break
            seen.add(cur)
            cur = parent.get(cur)
    return errors


def check_form_config(config: Any) -> None:
    """Raise `ValidationFailed` (422, code `invalid_form_config`, one entry per problem) when `config` is not a valid form."""
    doc = {"fields": config} if isinstance(config, list) else config
    errors: list[dict[str, str]] = []
    validator = _validator()
    if validator is not None:
        for e in sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))[:MAX_ERRORS]:
            known_type = e.validator == "enum" and list(e.absolute_path)[-1:] == ["type"]
            errors.append({"field": _where(e.absolute_path), "message": f'"{e.instance}" is not a field type this version knows' if known_type else e.message[:300]})
    elif not isinstance(doc, dict) or not isinstance(doc.get("fields", []), list):
        errors.append({"field": "form_config", "message": "Expected an object with a list of fields"})
    if not errors and isinstance(doc, dict) and isinstance(doc.get("fields"), list):
        errors.extend(_structure(doc["fields"])[:MAX_ERRORS])
        if not errors:
            for check in _checks:
                errors.extend(check(doc))
    if errors:
        raise ValidationFailed("The form's configuration is not valid", code="invalid_form_config", errors=errors)
