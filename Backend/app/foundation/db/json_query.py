"""Typed, allow-listed querying of a JSON document column (filter / search / sort / group / aggregate / facets).

Platform code: a feature declares *which* keys of the document are queryable and how to read them (`FieldSpec`); callers
send a data-only query (`Condition` / `Group`, no SQL, no paths). Every key is checked against the declared fields, every
value is bound as a parameter, and the number of conditions, nesting depth and list sizes are bounded.

Portable between PostgreSQL (JSONB) and SQLite (used by the unit tests). Values are read with a type guard
(`jsonb_typeof` / `json_type`) so a stray value of the wrong type never makes a query fail - it reads as NULL.
Dates are stored by the form engine as ISO-8601 strings, which sort lexicographically, so they are compared as text.
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Literal

from sqlalchemy import String, and_, case, cast, func, not_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.foundation.errors import BadRequest

Kind = Literal["text", "choice", "multi", "number", "date", "datetime", "boolean", "files", "rows", "person"]
Op = Literal["eq", "ne", "contains", "ncontains", "starts", "in", "nin", "gt", "gte", "lt", "lte", "between", "has", "hasany", "empty", "notempty"]
AggFn = Literal["count", "sum", "avg", "min", "max"]

OPS_BY_KIND: dict[str, tuple[str, ...]] = {
    "text": ("contains", "ncontains", "eq", "ne", "starts", "in", "nin", "empty", "notempty"),
    "choice": ("eq", "ne", "in", "nin", "contains", "empty", "notempty"),
    "multi": ("has", "hasany", "empty", "notempty"),
    "number": ("eq", "ne", "gt", "gte", "lt", "lte", "between", "empty", "notempty"),
    "date": ("eq", "gt", "gte", "lt", "lte", "between", "empty", "notempty"),
    "datetime": ("eq", "gt", "gte", "lt", "lte", "between", "empty", "notempty"),
    "boolean": ("eq", "empty", "notempty"),
    "files": ("empty", "notempty"),
    "rows": ("empty", "notempty"),
    "person": ("eq", "in", "nin", "empty", "notempty"),
}
SORTABLE_KINDS = frozenset({"text", "choice", "number", "date", "datetime", "boolean", "person"})
GROUPABLE_KINDS = frozenset({"text", "choice", "boolean", "date", "datetime", "person"})
AGGREGATABLE_KINDS = frozenset({"number"})
FACETABLE_KINDS = frozenset({"text", "choice", "boolean", "person"})
SEARCHABLE_KINDS = frozenset({"text", "choice"})

KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
MAX_CONDITIONS = 50
MAX_DEPTH = 4
MAX_LIST = 200
MAX_SEARCH = 100
MAX_SEARCH_FIELDS = 25
MAX_FACETS = 5
MAX_FACET_VALUES = 50
MAX_GROUPS = 200
MAX_GROUPS_2D = 600
DATE_BUCKETS = {"year": 4, "month": 7, "day": 10}


@dataclass(frozen=True)
class FieldSpec:
    """A queryable value. `column` is set for real table columns (status, created_at...), otherwise `key` is a top-level
    key of the JSON document."""

    key: str
    kind: Kind
    label: str = ""
    column: Any = None

    @property
    def ops(self) -> tuple[str, ...]:
        return OPS_BY_KIND[self.kind]

    @property
    def sortable(self) -> bool:
        return self.kind in SORTABLE_KINDS

    @property
    def groupable(self) -> bool:
        return self.kind in GROUPABLE_KINDS

    @property
    def aggregatable(self) -> bool:
        return self.kind in AGGREGATABLE_KINDS


# ---------------------------------------------------------------------------------------------------------------------
# value helpers
# ---------------------------------------------------------------------------------------------------------------------
def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _iso_day(v: Any) -> date:
    try:
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, date):
            return v
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).date() if len(str(v)) > 10 else date.fromisoformat(str(v))
    except ValueError:
        raise BadRequest(f"'{v}' is not a valid date", code="invalid_query") from None


def _as_number(v: Any) -> float:
    if isinstance(v, bool) or v is None:
        raise BadRequest("A number is required", code="invalid_query")
    try:
        return float(v)
    except (TypeError, ValueError):
        raise BadRequest(f"'{v}' is not a number", code="invalid_query") from None


def _as_list(v: Any) -> list:
    if not isinstance(v, list) or not v:
        raise BadRequest("A non-empty list is required", code="invalid_query")
    if len(v) > MAX_LIST:
        raise BadRequest(f"At most {MAX_LIST} values per condition", code="invalid_query")
    return v


def _text(v: Any) -> str:
    if v is None or isinstance(v, (dict, list)):
        raise BadRequest("A text value is required", code="invalid_query")
    return str(v)


class JsonQuery:
    """Compiles queries against `doc` (the JSON column) of `entity` for one SQL dialect."""

    def __init__(self, doc: Any, specs: Iterable[FieldSpec], dialect: str):
        self.doc = doc
        self.specs = {s.key: s for s in specs}
        self.pg = dialect == "postgresql"
        self._conditions = 0

    # -- reading values ---------------------------------------------------------------------------------------------
    def spec(self, key: str) -> FieldSpec:
        spec = self.specs.get(key) if isinstance(key, str) else None
        if spec is None:
            raise BadRequest(f"Unknown field '{key}'", code="invalid_query")
        return spec

    def _node(self, spec: FieldSpec):
        if not KEY_RE.match(spec.key):  # specs come from templates: never let an odd key reach a path
            raise BadRequest(f"Field '{spec.key}' cannot be queried", code="invalid_query")
        return self.doc[spec.key]

    def _json_type(self, spec: FieldSpec):
        return func.jsonb_typeof(self._node(spec)) if self.pg else func.json_type(self.doc, f'$."{spec.key}"')

    def text(self, spec: FieldSpec) -> ColumnElement:
        """The value as text (NULL when missing/null)."""
        if spec.column is not None:
            return spec.column if spec.kind in ("text", "choice") else cast(spec.column, String)
        return self._node(spec).as_string()

    def number(self, spec: FieldSpec) -> ColumnElement:
        node = self._node(spec)
        numeric = ("number",) if self.pg else ("integer", "real")
        return case((self._json_type(spec).in_(numeric), node.as_float()), else_=None)

    def boolean(self, spec: FieldSpec) -> ColumnElement:
        node = self._node(spec)
        kinds = ("boolean",) if self.pg else ("true", "false")
        return case((self._json_type(spec).in_(kinds), node.as_boolean()), else_=None)

    def raw_json_text(self, spec: FieldSpec) -> ColumnElement:
        return cast(self._node(spec), String)

    def value(self, spec: FieldSpec) -> ColumnElement:
        """The comparable/sortable/groupable expression of a field."""
        if spec.kind == "number":
            return self.number(spec)
        if spec.kind == "boolean":
            return spec.column if spec.column is not None else self.boolean(spec)
        if spec.kind == "person" and spec.column is not None:
            return spec.column
        return self.text(spec)

    # -- conditions -------------------------------------------------------------------------------------------------
    def _is_empty(self, spec: FieldSpec) -> ColumnElement:
        if spec.column is not None:
            return spec.column.is_(None)
        if spec.kind in ("multi", "files", "rows"):
            raw = self.raw_json_text(spec)
            return or_(raw.is_(None), raw.in_(("null", "[]", '""', "{}")))
        if spec.kind in ("text", "choice", "date", "datetime"):
            t = self.text(spec)
            return or_(t.is_(None), t == "")
        return self.value(spec).is_(None)

    def _date_clause(self, spec: FieldSpec, op: str, value: Any) -> ColumnElement:
        if spec.column is not None:  # a real timestamp column: bound by datetimes
            col = spec.column

            def lo(v):  # first instant of the day
                return datetime.combine(_iso_day(v), time.min, tzinfo=timezone.utc)

            def hi(v):  # first instant of the next day
                return lo(v) + timedelta(days=1)
        else:
            col = self.text(spec)

            def lo(v):
                return _iso_day(v).isoformat()

            def hi(v):
                return (_iso_day(v) + timedelta(days=1)).isoformat()

        if op == "eq":
            return and_(col >= lo(value), col < hi(value))
        if op == "gte":
            return col >= lo(value)
        if op == "gt":
            return col >= hi(value)
        if op == "lt":
            return col < lo(value)
        if op == "lte":
            return col < hi(value)
        if op == "between":
            pair = _as_list(value)
            if len(pair) != 2:
                raise BadRequest("'between' needs [from, to]", code="invalid_query")
            return and_(col >= lo(pair[0]), col < hi(pair[1]))
        raise BadRequest(f"Operator '{op}' is not valid for dates", code="invalid_query")

    def condition(self, field: str, op: str, value: Any = None) -> ColumnElement:
        self._conditions += 1
        if self._conditions > MAX_CONDITIONS:
            raise BadRequest(f"At most {MAX_CONDITIONS} conditions per query", code="invalid_query")
        spec = self.spec(field)
        if op not in spec.ops:
            raise BadRequest(f"Operator '{op}' is not valid for {spec.kind} field '{field}'", code="invalid_query")
        if op == "empty":
            return self._is_empty(spec)
        if op == "notempty":
            return not_(self._is_empty(spec))
        kind = spec.kind

        if kind in ("date", "datetime"):
            return self._date_clause(spec, op, value)

        if kind == "number":
            col = self.number(spec)
            if op == "between":
                pair = _as_list(value)
                if len(pair) != 2:
                    raise BadRequest("'between' needs [from, to]", code="invalid_query")
                return and_(col >= _as_number(pair[0]), col <= _as_number(pair[1]))
            n = _as_number(value)
            return {"eq": col == n, "ne": col != n, "gt": col > n, "gte": col >= n, "lt": col < n, "lte": col <= n}[op]

        if kind == "boolean":
            if not isinstance(value, bool):
                raise BadRequest("A true/false value is required", code="invalid_query")
            return self.value(spec) == value

        if kind == "person":
            col = self.value(spec)
            to_id = (lambda v: uuid.UUID(str(v))) if spec.column is not None else str
            try:
                if op == "eq":
                    return col == to_id(_text(value))
                ids = [to_id(_text(v)) for v in _as_list(value)]
            except ValueError:
                raise BadRequest("Invalid identifier", code="invalid_query") from None
            return col.in_(ids) if op == "in" else col.not_in(ids)

        if kind == "multi":
            raw = self.raw_json_text(spec)

            def has(v):  # exact element: the JSON encoding of the value, quotes included
                return raw.like(f"%{_like_escape(json.dumps(v, ensure_ascii=False))}%", escape="\\")

            if op == "has":
                return has(_text(value))
            return or_(*[has(_text(v)) for v in _as_list(value)])

        # text / choice
        col = self.text(spec)
        if op == "eq":
            return col == _text(value)
        if op == "ne":
            return or_(col.is_(None), col != _text(value))
        if op == "in":
            return col.in_([_text(v) for v in _as_list(value)])
        if op == "nin":
            return or_(col.is_(None), col.not_in([_text(v) for v in _as_list(value)]))
        needle = _like_escape(_text(value).lower())
        if op == "starts":
            return func.lower(col).like(f"{needle}%", escape="\\")
        if op == "ncontains":
            return or_(col.is_(None), not_(func.lower(col).like(f"%{needle}%", escape="\\")))
        return func.lower(col).like(f"%{needle}%", escape="\\")  # contains

    def group(self, node: dict, depth: int = 0) -> ColumnElement:
        """`node` is {"field","op","value"} or {"op": "and"|"or", "items": [...]} (already validated shapes)."""
        if depth > MAX_DEPTH:
            raise BadRequest(f"Filters can be nested at most {MAX_DEPTH} levels", code="invalid_query")
        if "items" in node:
            parts = [self.group(i, depth + 1) for i in node["items"]]
            if not parts:
                return and_(True)
            return or_(*parts) if node.get("op") == "or" else and_(*parts)
        return self.condition(node["field"], node["op"], node.get("value"))

    def search(self, term: str) -> ColumnElement | None:
        term = term.strip()
        if not term:
            return None
        if len(term) > MAX_SEARCH:
            raise BadRequest(f"Search text is limited to {MAX_SEARCH} characters", code="invalid_query")
        needle = f"%{_like_escape(term.lower())}%"
        fields = [s for s in self.specs.values() if s.kind in SEARCHABLE_KINDS][:MAX_SEARCH_FIELDS]
        if not fields:
            return None
        return or_(*[func.lower(self.text(s)).like(needle, escape="\\") for s in fields])

    # -- ordering, grouping, aggregates ----------------------------------------------------------------------------
    def order_by(self, sort: list[tuple[str, bool]]) -> list[ColumnElement]:
        out: list[ColumnElement] = []
        for field, desc in sort:
            spec = self.spec(field)
            if not spec.sortable:
                raise BadRequest(f"Cannot sort by '{field}'", code="invalid_sort")
            expr = self.value(spec)
            out.append(expr.is_(None))  # missing values last, whatever the direction
            out.append(expr.desc() if desc else expr.asc())
        return out

    def group_expr(self, field: str, bucket: str | None = None) -> ColumnElement:
        spec = self.spec(field)
        if not spec.groupable:
            raise BadRequest(f"Cannot group by '{field}'", code="invalid_query")
        if spec.kind in ("date", "datetime"):
            width = DATE_BUCKETS.get(bucket or "month")
            if width is None:
                raise BadRequest("bucket must be year, month or day", code="invalid_query")
            return func.substr(cast(self.value(spec), String), 1, width)
        return self.value(spec)

    def aggregate(self, fn: str, field: str | None) -> ColumnElement:
        if fn == "count":
            return func.count()
        if field is None:
            raise BadRequest(f"'{fn}' needs a field", code="invalid_query")
        spec = self.spec(field)
        if not spec.aggregatable:
            raise BadRequest(f"Cannot aggregate '{field}'", code="invalid_query")
        col = self.number(spec)
        return {"sum": func.sum(col), "avg": func.avg(col), "min": func.min(col), "max": func.max(col)}[fn]

    def facet_expr(self, field: str) -> ColumnElement:
        spec = self.spec(field)
        if spec.kind not in FACETABLE_KINDS:
            raise BadRequest(f"Cannot facet by '{field}'", code="invalid_query")
        return self.value(spec)


def to_python(v: Any) -> Any:
    """Make a database scalar JSON-friendly (Decimal -> float, UUID -> str)."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v)


__all__ = ["FieldSpec", "JsonQuery", "OPS_BY_KIND", "MAX_FACETS", "MAX_FACET_VALUES", "MAX_GROUPS", "MAX_GROUPS_2D", "to_python"]
