"""Export of submitted data as CSV: what people read (names and labels, not ids), safe to open in a spreadsheet."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any
from uuid import UUID

MAX_EXPORT_ROWS = 50_000
BATCH = 1000
_DANGEROUS_START = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: str) -> str:
    """A spreadsheet runs a cell that starts with = + - @ as a formula. Prefixing a quote makes it text (OWASP CSV injection)."""
    return "'" + value if value.startswith(_DANGEROUS_START) else value


def render_csv(headers: list[str], rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow([safe_cell(h) for h in headers])
    for row in rows:
        writer.writerow([safe_cell(c) for c in row])
    return b"\xef\xbb\xbf" + out.getvalue().encode("utf-8")  # BOM: Excel reads UTF-8 correctly


def _names(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("filename") or "")
    return str(value)


def format_value(field: dict, value: Any, people: dict[UUID, str]) -> str:
    """One stored value as the text a person would write down."""
    if value is None or value == "" or value == []:
        return ""
    kind = field["kind"]
    labels = {str(o["value"]): str(o["label"]) for o in field.get("options", [])}

    def one(v: Any) -> str:
        if kind == "person":
            try:
                return people.get(UUID(str(v)), str(v))
            except ValueError:
                return str(v)
        return labels.get(str(v), str(v))

    if kind == "boolean":
        return "Yes" if value else "No"
    if kind == "files":
        return ", ".join(filter(None, (_names(v) for v in (value if isinstance(value, list) else [value]))))
    if kind == "rows":
        return f"{len(value)} rows" if isinstance(value, list) else ""
    if isinstance(value, list):
        return ", ".join(one(v) for v in value)
    if isinstance(value, (dict,)):
        return str(value)
    return one(value)


def iso(v: datetime | None) -> str:
    return v.isoformat() if v else ""
