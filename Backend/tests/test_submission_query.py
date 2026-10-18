"""Data viewer query API: filters, search, sort, group, aggregate, facets, limits and isolation."""
import pytest

from tests.conftest import TEMPLATE  # noqa: F401

FIELDS = [
    {"id": "title", "type": "InputText", "label": "Title", "props": {"required": True}},
    {"id": "dept", "type": "Dropdown", "label": "Department", "data": {"dataSource": {"staticData": [{"label": "Sales", "value": "sales"}, {"label": "Ops", "value": "ops"}, {"label": "HR", "value": "hr"}]}}},
    {"id": "tags", "type": "MultiSelect", "label": "Tags"},
    {"id": "amount", "type": "InputNumber", "label": "Amount", "props": {"mode": "currency", "currency": "USD"}},
    {"id": "when", "type": "Calendar", "label": "Date"},
    {"id": "urgent", "type": "Checkbox", "label": "Urgent"},
    {"id": "docs", "type": "FileUpload", "label": "Docs"},
    {"id": "lines", "type": "FormArray", "label": "Lines"},
    {"id": "line_qty", "type": "InputNumber", "label": "Qty", "parentId": "lines"},
    {"id": "secret", "type": "Password", "label": "Pwd"},
]
ROWS = [
    {"title": "Alpha 100%", "dept": "sales", "tags": ["a", "b"], "amount": 100, "when": "2026-09-01T00:00:00.000Z", "urgent": True, "lines": [{"line_qty": 1}]},
    {"title": "Beta_x", "dept": "sales", "tags": ["b"], "amount": 250.5, "when": "2026-09-15T10:00:00.000Z", "urgent": False, "lines": []},
    {"title": "Gamma", "dept": "ops", "tags": [], "amount": 40, "when": "2026-10-02T00:00:00.000Z", "urgent": False, "docs": [{"name": "a.pdf"}], "lines": [{"line_qty": 2}, {"line_qty": 3}]},
    {"title": "delta", "dept": "hr", "amount": "n/a", "when": None, "urgent": None},  # wrong type + missing values must not break queries
]


async def _seed(client, h, fields=FIELDS, rows=ROWS):
    t = (await client.post("/template/forms/templates", headers=h, json={"name": "Req", "form_config": {"fields": fields}, "file_relations": []})).json()
    for r in rows:
        assert (await client.post("/form/submissions", headers=h, json={"template_id": t["id"], "submission_data": r})).status_code == 201
    return t["id"]


async def q(client, h, tid, **body):
    r = await client.post("/form/submissions/query", headers=h, json={"template_id": tid, **body})
    return r


def titles(r):
    return [i["submission_data"]["title"] for i in r.json()["items"]]


def cond(field, op, value=None):
    return {"filter": {"op": "and", "items": [{"field": field, "op": op, "value": value}]}}


@pytest.mark.asyncio
async def test_schema_describes_fields_roles_and_modes(client, acme):
    tid = await _seed(client, acme["h"])
    s = (await client.get("/form/submissions/query/schema", headers=acme["h"], params={"template_id": tid})).json()
    kinds = {f["key"]: f["kind"] for f in s["fields"]}
    assert kinds["title"] == "text" and kinds["dept"] == "choice" and kinds["tags"] == "multi" and kinds["amount"] == "number"
    assert kinds["when"] == "date" and kinds["urgent"] == "boolean" and kinds["docs"] == "files" and kinds["lines"] == "rows"
    assert "secret" not in kinds and "line_qty" not in kinds  # passwords and row-scoped fields are not queryable
    assert s["roles"]["title"] == "title" and s["roles"]["stage"] == "dept" and s["roles"]["date"] == "when" and s["roles"]["measures"] == ["amount"]
    assert {"table", "cards", "board", "calendar", "pivot", "dashboard"} <= set(s["modes"])
    assert next(f for f in s["fields"] if f["key"] == "dept")["options"][0] == {"value": "sales", "label": "Sales"}


@pytest.mark.asyncio
@pytest.mark.parametrize("body,expected", [
    (cond("dept", "eq", "sales"), {"Alpha 100%", "Beta_x"}),
    (cond("dept", "in", ["ops", "hr"]), {"Gamma", "delta"}),
    (cond("dept", "ne", "sales"), {"Gamma", "delta"}),
    (cond("title", "contains", "ALPHA"), {"Alpha 100%"}),
    (cond("title", "contains", "100%"), {"Alpha 100%"}),  # % is literal, not a wildcard
    (cond("title", "contains", "_"), {"Beta_x"}),  # _ is literal too
    (cond("title", "starts", "ga"), {"Gamma"}),
    (cond("title", "ncontains", "a"), set()),
    (cond("amount", "gt", 100), {"Beta_x"}),
    (cond("amount", "gte", 100), {"Alpha 100%", "Beta_x"}),
    (cond("amount", "between", [40, 100]), {"Alpha 100%", "Gamma"}),
    (cond("amount", "empty"), {"delta"}),  # the string "n/a" reads as no number
    (cond("amount", "notempty"), {"Alpha 100%", "Beta_x", "Gamma"}),
    (cond("when", "eq", "2026-09-15"), {"Beta_x"}),
    (cond("when", "gte", "2026-09-15"), {"Beta_x", "Gamma"}),
    (cond("when", "gt", "2026-09-15"), {"Gamma"}),
    (cond("when", "lte", "2026-09-15"), {"Alpha 100%", "Beta_x"}),
    (cond("when", "between", ["2026-09-01", "2026-09-30"]), {"Alpha 100%", "Beta_x"}),
    (cond("when", "empty"), {"delta"}),
    (cond("urgent", "eq", True), {"Alpha 100%"}),
    (cond("urgent", "eq", False), {"Beta_x", "Gamma"}),
    (cond("tags", "has", "b"), {"Alpha 100%", "Beta_x"}),
    (cond("tags", "hasany", ["a", "zzz"]), {"Alpha 100%"}),
    (cond("tags", "empty"), {"Gamma", "delta"}),
    (cond("docs", "notempty"), {"Gamma"}),
    (cond("lines", "notempty"), {"Alpha 100%", "Gamma"}),
    (cond("lines", "empty"), {"Beta_x", "delta"}),
    ({"filter": {"op": "or", "items": [{"field": "dept", "op": "eq", "value": "hr"}, {"op": "and", "items": [{"field": "amount", "op": "lt", "value": 50}, {"field": "urgent", "op": "eq", "value": False}]}]}}, {"delta", "Gamma"}),
    ({"search": "beta"}, {"Beta_x"}),
    ({"search": "ops"}, {"Gamma"}),
    ({"search": "%"}, {"Alpha 100%"}),
    ({}, {"Alpha 100%", "Beta_x", "Gamma", "delta"}),
])
async def test_filters(client, acme, body, expected):
    tid = await _seed(client, acme["h"])
    r = await q(client, acme["h"], tid, **body)
    assert r.status_code == 200, r.text
    assert set(titles(r)) == expected
    assert r.json()["total"] == len(expected)


@pytest.mark.asyncio
async def test_builtin_fields_and_people(client, acme):
    tid = await _seed(client, acme["h"])
    me = str(acme["user"].id)
    assert (await q(client, acme["h"], tid, **cond("submitted_by", "eq", me))).json()["total"] == 4
    assert (await q(client, acme["h"], tid, **cond("submitted_by", "eq", "00000000-0000-0000-0000-000000000000"))).json()["total"] == 0
    assert (await q(client, acme["h"], tid, **cond("status", "empty"))).status_code == 200
    day = (await q(client, acme["h"], tid, **cond("created_at", "gte", "2020-01-01"))).json()
    assert day["total"] == 4 and day["items"][0]["submitted_by_name"]  # name resolved for the table
    assert (await q(client, acme["h"], tid, **cond("created_at", "lt", "2020-01-01"))).json()["total"] == 0


@pytest.mark.asyncio
async def test_sort_paginate_nulls_last(client, acme):
    tid = await _seed(client, acme["h"])
    asc = await q(client, acme["h"], tid, sort=[{"field": "amount"}])
    assert titles(asc) == ["Gamma", "Alpha 100%", "Beta_x", "delta"]
    desc = await q(client, acme["h"], tid, sort=[{"field": "amount", "desc": True}])
    assert titles(desc) == ["Beta_x", "Alpha 100%", "Gamma", "delta"]  # missing value last in both directions
    by_title = await q(client, acme["h"], tid, sort=[{"field": "dept"}, {"field": "title"}])
    assert titles(by_title) == ["delta", "Gamma", "Alpha 100%", "Beta_x"]  # hr < ops < sales, then by title
    page = (await q(client, acme["h"], tid, sort=[{"field": "amount"}], page=2, page_size=3)).json()
    assert page["total"] == 4 and [i["submission_data"]["title"] for i in page["items"]] == ["delta"]
    assert (await q(client, acme["h"], tid, sort=[{"field": "tags"}])).status_code == 400  # multi values are not sortable


@pytest.mark.asyncio
async def test_aggregates_groups_and_facets(client, acme):
    tid = await _seed(client, acme["h"])
    r = (await q(client, acme["h"], tid, rows=False, aggregates=[{"fn": "count"}, {"fn": "sum", "field": "amount"}, {"fn": "avg", "field": "amount", "alias": "mean"}, {"fn": "max", "field": "amount"}],
                 group_by={"field": "dept"}, facets=["dept", "urgent"])).json()
    assert r["items"] == [] and r["total"] == 4
    assert r["aggregates"]["count"] == 4 and r["aggregates"]["sum_amount"] == pytest.approx(390.5) and r["aggregates"]["mean"] == pytest.approx(390.5 / 3) and r["aggregates"]["max_amount"] == 250.5
    by = {g["key"]: g for g in r["groups"]}
    assert by["sales"]["count"] == 2 and by["sales"]["aggregates"]["sum_amount"] == pytest.approx(350.5) and by["ops"]["count"] == 1
    assert r["groups"][0]["key"] == "sales"  # biggest group first
    assert {f["value"]: f["count"] for f in r["facets"]["dept"]} == {"sales": 2, "ops": 1, "hr": 1}
    assert {f["value"]: f["count"] for f in r["facets"]["urgent"]} == {"true": 1, "false": 2, None: 1}
    month = (await q(client, acme["h"], tid, rows=False, group_by={"field": "when", "bucket": "month"})).json()["groups"]
    assert [(g["key"], g["count"]) for g in month if g["key"]] == [("2026-09", 2), ("2026-10", 1)]
    scoped = (await q(client, acme["h"], tid, rows=False, aggregates=[{"fn": "sum", "field": "amount"}], **cond("dept", "eq", "sales"))).json()
    assert scoped["aggregates"]["sum_amount"] == pytest.approx(350.5)  # aggregates honour the filter


@pytest.mark.asyncio
async def test_rejects_unknown_fields_bad_operators_and_abuse(client, acme):
    h = acme["h"]
    tid = await _seed(client, h)
    bad = [
        cond("nope", "eq", 1), cond("secret", "eq", "x"), cond("line_qty", "gt", 1),  # unknown / password / row-scoped
        cond("title", "gt", "a"), cond("amount", "contains", "1"), cond("tags", "eq", "a"),  # operator not valid for the kind
        cond("amount", "gt", "abc"), cond("when", "eq", "not-a-date"), cond("urgent", "eq", "yes"), cond("dept", "in", []), cond("amount", "between", [1]),
        cond("title", "eq", {"$ne": 1}), cond("dept", "in", list(range(300))),
        {"filter": {"items": [{"field": "title\"; drop table x;--", "op": "eq", "value": 1}]}},
        {"aggregates": [{"fn": "sum", "field": "title"}]}, {"aggregates": [{"fn": "sum"}]}, {"aggregates": [{"fn": "count", "alias": "a b"}]},
        {"group_by": {"field": "tags"}}, {"group_by": {"field": "amount"}}, {"group_by": {"field": "when", "bucket": "week"}}, {"facets": ["tags"]},
        {"search": "x" * 101}, {"page_size": 1000}, {"sort": [{"field": "a"}, {"field": "b"}, {"field": "c"}, {"field": "d"}]},
    ]
    for body in bad:
        r = await q(client, h, tid, **body)
        assert r.status_code in (400, 422), (body, r.status_code, r.text)
    nested = {"op": "and", "items": []}
    for _ in range(8):
        nested = {"op": "and", "items": [nested]}
    assert (await q(client, h, tid, filter=nested)).status_code == 400  # too deep
    many = {"op": "and", "items": [{"field": "title", "op": "eq", "value": str(i)} for i in range(50)] * 2}
    assert (await q(client, h, tid, filter={"op": "and", "items": many["items"][:50]})).status_code == 200
    assert (await q(client, h, tid, filter={"op": "and", "items": [{"op": "and", "items": many["items"][:50]}, {"field": "title", "op": "eq", "value": "x"}]})).status_code == 400  # > 50 conditions


@pytest.mark.asyncio
async def test_query_is_tenant_isolated_and_skips_deleted(client, acme, globex):
    tid = await _seed(client, acme["h"])
    # another tenant cannot query or describe it, and sees none of its rows
    assert (await q(client, globex["h"], tid)).status_code == 404
    assert (await client.get("/form/submissions/query/schema", headers=globex["h"], params={"template_id": tid})).status_code == 404
    other = await _seed(client, globex["h"], rows=[{"title": "Globex only", "dept": "sales"}])
    assert titles(await q(client, globex["h"], other)) == ["Globex only"]
    # deleted rows disappear
    first = (await q(client, acme["h"], tid, **cond("title", "eq", "Gamma"))).json()["items"][0]["id"]
    assert (await client.delete(f"/form/submissions/{first}", headers=acme["h"])).status_code == 204
    assert (await q(client, acme["h"], tid)).json()["total"] == 3


@pytest.mark.asyncio
async def test_query_requires_login_and_read_permission(client, acme):
    tid = await _seed(client, acme["h"])
    assert (await client.post("/form/submissions/query", json={"template_id": tid})).status_code == 401
    assert (await client.get("/form/submissions/query/schema", params={"template_id": tid})).status_code == 401


@pytest.mark.asyncio
async def test_two_level_grouping_for_pivots(client, acme):
    tid = await _seed(client, acme["h"])
    r = (await q(client, acme["h"], tid, rows=False, group_by={"field": "dept"}, then_by={"field": "urgent"}, aggregates=[{"fn": "sum", "field": "amount"}])).json()
    cells = {(g["key"], g["key2"]): (g["count"], g["aggregates"]["sum_amount"]) for g in r["groups"]}
    assert cells[("sales", "true")] == (1, 100) and cells[("sales", "false")] == (1, 250.5) and cells[("ops", "false")] == (1, 40)
    assert cells[("hr", None)][0] == 1  # no value is its own cell
    assert sum(c for c, _ in cells.values()) == 4
    by_month = (await q(client, acme["h"], tid, rows=False, group_by={"field": "when", "bucket": "month"}, then_by={"field": "dept"})).json()["groups"]
    assert [(g["key"], g["key2"], g["count"]) for g in by_month if g["key"]] == [("2026-09", "sales", 2), ("2026-10", "ops", 1)]
    assert (await q(client, acme["h"], tid, then_by={"field": "dept"})).status_code == 400  # needs group_by
    assert (await q(client, acme["h"], tid, group_by={"field": "dept"}, then_by={"field": "tags"})).status_code == 400  # not groupable


@pytest.mark.asyncio
async def test_export_csv_is_readable_filtered_safe_and_audited(client, acme, db):
    h = acme["h"]
    rows = ROWS + [{"title": "=HYPERLINK(\"http://evil\")", "dept": "sales", "amount": 1}]
    tid = await _seed(client, h, rows=rows)
    r = await client.post("/form/submissions/export", headers=h, json={"template_id": tid, "sort": [{"field": "amount"}]})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    text = r.content.decode("utf-8-sig")
    lines = text.strip().split("\r\n")
    assert lines[0].startswith("Submitted,Status,Submitted by,Title,Department,Tags,Amount,Date,Urgent,Docs,Lines") and r.headers["x-row-count"] == "5"
    assert "Sales" in text and "sales" not in text.replace("Sales", "")  # option labels, not stored values
    assert "'=HYPERLINK" in text and "\r\n=HYPERLINK" not in text  # a formula is shown as text
    import csv, io
    table = list(csv.reader(io.StringIO(text)))
    head = table[0]
    by_title = {row[head.index("Title")]: dict(zip(head, row)) for row in table[1:]}
    gamma = by_title["Gamma"]
    assert gamma["Submitted by"] != "" and "-" not in gamma["Submitted by"][:8], "the submitter is shown by name, not id"
    assert (gamma["Department"], gamma["Urgent"], gamma["Docs"], gamma["Lines"]) == ("Ops", "No", "a.pdf", "2 rows")  # label, No, file name, row count
    assert (by_title["Alpha 100%"]["Urgent"], by_title["Alpha 100%"]["Tags"]) == ("Yes", "a, b")
    assert by_title["delta"]["Amount"] == "n/a" and by_title["Beta_x"]["Amount"] == "250.5"
    # same filter as the viewer
    only = await client.post("/form/submissions/export", headers=h, json={"template_id": tid, "filter": {"op": "and", "items": [{"field": "dept", "op": "eq", "value": "ops"}]}, "fields": ["title", "dept"]})
    assert only.content.decode("utf-8-sig").strip().split("\r\n") == ["Title,Department", "Gamma,Ops"]
    from sqlalchemy import text as sql
    from app.foundation import context
    with context.system_context():
        async with db.sessionmaker() as s:
            audited = (await s.execute(sql("SELECT changes FROM audit_logs WHERE action = 'export' ORDER BY occurred_at"))).all()
    import json
    sizes = [(json.loads(c) if isinstance(c, str) else c)["rows"] for (c,) in audited]
    assert sizes == [5, 1]  # every export is recorded, with its size
    assert (await client.post("/form/submissions/export", headers=h, json={"template_id": tid, "fields": ["secret"]})).status_code == 400
    assert (await client.post("/form/submissions/export", headers=h, json={"template_id": tid, "filter": {"items": [{"field": "nope", "op": "eq", "value": 1}]}})).status_code == 400


@pytest.mark.asyncio
async def test_export_needs_the_export_right_and_stays_in_the_tenant(client, acme, globex):
    from tests.test_saved_views import _user
    h = acme["h"]
    tid = await _seed(client, h, rows=ROWS[:1])
    viewer = await _user(client, h, "vw@acme-corp.org", "viewer")
    submitter = await _user(client, h, "sub@acme-corp.org", "submitter")
    editor = await _user(client, h, "ed@acme-corp.org", "editor")
    for who, code in ((viewer, 403), (submitter, 403), (editor, 200), (h, 200)):
        assert (await client.post("/form/submissions/export", headers=who, json={"template_id": tid})).status_code == code
    assert (await client.post("/form/submissions/export", headers=globex["h"], json={"template_id": tid})).status_code == 404
