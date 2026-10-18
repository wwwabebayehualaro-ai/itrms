from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Mapping
from uuid import UUID

from fastapi import Depends
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import context
from app.foundation.audit.model import AuditLog
from app.foundation.audit.service import record_event
from app.foundation.db.pagination import Page, PageParams
from app.foundation.db.repository import CrudService, Repository
from app.foundation.db.session import get_session
from app.foundation.db.json_query import MAX_FACET_VALUES, MAX_GROUPS, MAX_GROUPS_2D, JsonQuery, to_python
from app.foundation.errors import BadRequest, Conflict, NotFound
from app.modules.form_submission.models.FormSubmission import FormSubmission
from app.modules.form_builder.models.TemplateVersion import TemplateVersion
from app.foundation.auth.models import User
from app.modules.form_submission.schemas.form_submission_fetch_schema import FormSubmissionResponse
from app.modules.form_submission.schemas.form_submission_query_schema import FacetValue, ExportRequest, FieldChange, GroupResult, HistoryEntry, RecordForm, SubmissionQuery, SubmissionQueryResult
from app.modules.form_submission.services import server_actions, submission_export, submission_fields
from app.modules.form_builder.services.form_service import TemplateRepository
from app.modules.form_builder.services.versions import content_hash, get_version, live_config  # noqa: F401  (content_hash: public here before)

QUERY_TIMEOUT_MS = 15_000
DRAFT = "draft"


def diff_changes(changes: dict | None) -> list[FieldChange]:
    """Audit `changes` as one entry per field; the keys of `submission_data` are listed individually."""
    out: list[FieldChange] = []
    for field, ch in (changes or {}).items():
        if not isinstance(ch, dict) or not ({"old", "new"} & set(ch)):
            out.append(FieldChange(field=field, new=ch))
        elif field == "submission_data" and isinstance(ch.get("old") or {}, dict) and isinstance(ch.get("new") or {}, dict):
            old, new = ch.get("old") or {}, ch.get("new") or {}
            out += [FieldChange(field=k, old=old.get(k), new=new.get(k)) for k in sorted(set(old) | set(new)) if old.get(k) != new.get(k)]
        else:
            out.append(FieldChange(field=field, old=ch.get("old"), new=ch.get("new")))
    return out


def _key(v: Any) -> str | None:
    """A group/facet value as the string the client filters with (booleans as true/false)."""
    v = to_python(v)
    return None if v is None else str(v).lower() if isinstance(v, bool) else str(v)


class SubmissionRepository(Repository[FormSubmission]):
    model = FormSubmission
    resource_name = "Submission"
    filterable = frozenset({"template_id", "status", "submitted_by"})
    sortable = frozenset({"created_at", "updated_at", "status"})


class FormSubmissionService(CrudService[FormSubmission]):
    repository_class = SubmissionRepository

    async def _ensure_template(self, template_id: UUID):
        # The tenant guard makes other tenants' templates invisible, so this is also a cross-tenant check.
        template = await TemplateRepository(self.session).get_or_none(template_id)
        if template is None:
            raise NotFound("Form template not found")
        return template

    # -- field-level access: values of fields restricted to other roles never leave the server -------------------------
    async def _hidden_for(self, template_id: UUID) -> frozenset[str]:
        """Keys of submission data the caller may not see (`visibleToRoles` on the form's fields). Computed once per request."""
        roles = context.roles_var.get()
        if "admin" in roles:
            return frozenset()
        cache: dict = self.__dict__.setdefault("_hidden_cache", {})
        if template_id not in cache:
            template = await TemplateRepository(self.session).get_or_none(template_id)
            older = list((await self.session.execute(select(TemplateVersion.form_config).where(TemplateVersion.template_id == template_id))).scalars().all())
            cache[template_id] = submission_fields.hidden_keys(template.form_config if template is not None else None, older, roles)
        return cache[template_id]

    @staticmethod
    def _without(data: Mapping[str, Any] | None, hidden: frozenset[str]):
        return data if not hidden or data is None else {k: v for k, v in data.items() if k not in hidden}

    async def present(self, sub: FormSubmission) -> FormSubmissionResponse:
        """A submission as the caller may see it. A copy: the stored row is never changed."""
        out = FormSubmissionResponse.model_validate(sub)
        hidden = await self._hidden_for(sub.template_id)
        if hidden:
            out = out.model_copy(update={"submission_data": self._without(out.submission_data, hidden), "files_uploaded": self._without(out.files_uploaded, hidden)})
        return out

    async def present_page(self, page: Page[FormSubmission]) -> dict[str, Any]:
        return {"items": [(await self.present(r)).model_dump() for r in page.items], "total": page.total, "page": page.page, "page_size": page.page_size}

    @staticmethod
    def _published_version_id(template) -> UUID:
        """Requests are filled in on the published form; a form that was never published cannot take requests yet."""
        if template.published_version_id is None:
            raise Conflict("This form is not published yet", code="form_not_published")
        return template.published_version_id

    async def create_submission(self, data: Mapping[str, Any]) -> FormSubmission:
        template = await self._ensure_template(data["template_id"])
        payload = dict(data)
        hidden = await self._hidden_for(template.id)  # a caller cannot fill in what they may not see
        payload["submission_data"] = self._without(payload.get("submission_data"), hidden) or {}
        if payload.get("files_uploaded") is not None:
            payload["files_uploaded"] = self._without(payload["files_uploaded"], hidden)
        payload["template_version_id"] = self._published_version_id(template)
        payload.pop("submitted_by", None)
        payload["submitted_by"] = context.actor_id_var.get()  # never trust the client for identity
        payload["form_metadata"] = self._client_metadata(payload.get("form_metadata"))
        async with self.transaction():
            if payload.get("status") != DRAFT:
                payload["id"] = uuid.uuid4()
                await self._run_server_action(payload, template, payload["template_version_id"])
            obj = await self.repo.add(payload)
        await self.session.refresh(obj)
        return obj

    # -- server actions: coded work the form asks for on submit, saved with the request in one transaction --------------
    @staticmethod
    def _client_metadata(meta: Mapping[str, Any] | None) -> dict[str, Any] | None:
        """Which action ran is recorded by the server only."""
        return None if meta is None else {k: v for k, v in meta.items() if k != server_actions.META_KEY}

    async def _run_server_action(self, payload: dict[str, Any], template, version_id: UUID) -> None:
        version = await get_version(self.session, version_id)
        key = server_actions.action_key(version.form_config if version is not None else None)
        if key is None:
            return
        values = payload.get("submission_data") or {}
        result = await server_actions.run(self.session, key, submission_id=payload["id"], template_id=template.id, template_name=template.name, values=values)
        payload["submission_data"] = {**values, **result.data}
        payload["status"] = result.status
        payload["form_metadata"] = {**(payload.get("form_metadata") or {}), server_actions.META_KEY: key}

    @staticmethod
    def _ensure_unlocked(sub: FormSubmission) -> None:
        if server_actions.locked(sub):
            raise Conflict("This request was processed by the system and can no longer be changed", code="submission_locked")

    async def create_draft_submission(self, template_id: UUID) -> FormSubmission:
        return await self.create_submission({"template_id": template_id, "status": "draft", "submission_data": {}})

    async def list_submissions(self, params: PageParams, *, template_id: UUID | None = None, status: str | None = None,
                               created_after: datetime | None = None, sort: str | None = None, submitted_by: UUID | None = None) -> Page[FormSubmission]:
        where = [FormSubmission.created_at >= created_after] if created_after else []
        return await self.repo.list(params=params, filters={"template_id": template_id, "status": status, "submitted_by": submitted_by}, where=where, sort=sort)

    # -- data viewer ---------------------------------------------------------------------------------------------
    async def view_schema(self, template_id: UUID) -> dict[str, Any]:
        template = await TemplateRepository(self.session).get(template_id)  # tenant-guarded: other tenants' ids are 404
        return submission_fields.describe(await live_config(self.session, template), await self._hidden_for(template.id))

    @staticmethod
    def _conditions(jq: JsonQuery, template_id: UUID, flt, search: str | None) -> list:
        cond = [FormSubmission.template_id == template_id, FormSubmission.deleted_at.is_(None)]
        if flt and flt.items:
            cond.append(jq.group(flt.model_dump()))
        if (needle := jq.search(search or "")) is not None:
            cond.append(needle)
        return cond

    async def export_csv(self, q: ExportRequest) -> tuple[str, bytes, int]:
        """The requests the viewer shows, as CSV with names and labels instead of ids. Audited; bounded."""
        template = await self._ensure_template(q.template_id)
        dialect = self.session.get_bind().dialect.name
        hidden = await self._hidden_for(template.id)
        jq = JsonQuery(FormSubmission.submission_data, submission_fields.specs(await live_config(self.session, template), hidden), dialect)
        if dialect == "postgresql":
            await self.session.execute(text(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS * 4}"))
        cond = self._conditions(jq, q.template_id, q.filter, q.search)
        fields = {f["id"]: f for f in submission_fields.value_fields(await live_config(self.session, template), hidden)}
        builtin = {"status": "Status", "created_at": "Submitted", "updated_at": "Updated", "submitted_by": "Submitted by"}
        keys = q.fields or ["created_at", "status", "submitted_by", *fields]
        for k in keys:
            if k not in builtin and k not in fields:
                raise BadRequest(f"Unknown field '{k}'", code="invalid_query")
        order = jq.order_by([(k.field, k.desc) for k in q.sort] or [("created_at", True)])
        records: list[FormSubmission] = []
        for offset in range(0, submission_export.MAX_EXPORT_ROWS + 1, submission_export.BATCH):
            stmt = select(FormSubmission).where(*cond).order_by(*order, FormSubmission.id).offset(offset).limit(submission_export.BATCH)
            batch = list((await self.session.execute(stmt)).scalars().all())
            records += batch
            if len(batch) < submission_export.BATCH:
                break
        if len(records) > submission_export.MAX_EXPORT_ROWS:
            raise BadRequest(f"More than {submission_export.MAX_EXPORT_ROWS} requests match. Narrow the filter and export again.", code="export_too_large")

        ids = {r.submitted_by for r in records if r.submitted_by}
        for f in fields.values():
            if f["kind"] == "person":
                for r in records:
                    v = (r.submission_data or {}).get(f["id"])
                    try:
                        ids.add(UUID(str(v)))
                    except (ValueError, TypeError):
                        pass
        people = await self._people(ids)

        def cell(r: FormSubmission, key: str) -> str:
            if key == "status":
                return r.status or ""
            if key == "created_at":
                return submission_export.iso(r.created_at)
            if key == "updated_at":
                return submission_export.iso(r.updated_at)
            if key == "submitted_by":
                return people.get(r.submitted_by, "") if r.submitted_by else ""
            return submission_export.format_value(fields[key], (r.submission_data or {}).get(key), people)

        headers = [builtin.get(k) or fields[k]["label"] for k in keys]
        body = submission_export.render_csv(headers, [[cell(r, k) for k in keys] for r in records])
        await record_event("export", "form_submissions", str(template.id), changes={"rows": len(records), "search": q.search or None, "filters": len(q.filter.items) if q.filter else 0, "fields": len(keys)})
        stamp = datetime.now().strftime("%Y%m%d")
        slug = "".join(c for c in template.slug if c.isalnum() or c in "-_")[:60] or "requests"
        return f"{slug}-{stamp}.csv", body, len(records)

    async def query(self, q: SubmissionQuery) -> SubmissionQueryResult:
        """Filter / search / sort / group / aggregate the submissions of ONE form. Everything the caller names is checked
        against the fields the template declares; values are bound parameters; tenant and soft-delete scoping are automatic."""
        template = await TemplateRepository(self.session).get(q.template_id)
        dialect = self.session.get_bind().dialect.name
        hidden = await self._hidden_for(template.id)
        jq = JsonQuery(FormSubmission.submission_data, submission_fields.specs(await live_config(self.session, template), hidden), dialect)
        if dialect == "postgresql":
            await self.session.execute(text(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS}"))

        cond = self._conditions(jq, q.template_id, q.filter, q.search)

        async def scalars(*cols):
            return (await self.session.execute(select(*cols).select_from(FormSubmission).where(*cond))).one()

        total = (await scalars(func.count()))[0]

        agg_cols = [jq.aggregate(a.fn, a.field).label(a.name) for a in q.aggregates]
        aggregates: dict[str, Any] = {}
        if agg_cols:
            row = await scalars(*agg_cols)
            aggregates = {a.name: to_python(v) for a, v in zip(q.aggregates, row)}

        groups: list[GroupResult] = []
        if q.then_by and not q.group_by:
            raise BadRequest("then_by needs group_by", code="invalid_query")
        if q.group_by:
            dims = [q.group_by] + ([q.then_by] if q.then_by else [])
            keys = [jq.group_expr(d.field, d.bucket) for d in dims]
            n = len(keys)
            first_is_date = jq.spec(q.group_by.field).kind in ("date", "datetime")
            # positional GROUP BY / ORDER BY: key expressions carry bound parameters and must not be repeated
            stmt = (select(*keys, func.count(), *agg_cols).select_from(FormSubmission).where(*cond)
                    .group_by(*[literal_column(str(i + 1)) for i in range(n)])
                    .order_by(*([literal_column("1").asc(), literal_column("2").asc()][:n] if first_is_date else [literal_column(str(n + 1)).desc()]))
                    .limit(MAX_GROUPS_2D if n == 2 else MAX_GROUPS))
            for r in (await self.session.execute(stmt)).all():
                groups.append(GroupResult(key=_key(r[0]), key2=_key(r[1]) if n == 2 else None, count=r[n], aggregates={a.name: to_python(v) for a, v in zip(q.aggregates, r[n + 1:])}))

        facets: dict[str, list[FacetValue]] = {}
        for field in dict.fromkeys(q.facets):
            stmt = select(jq.facet_expr(field), func.count()).select_from(FormSubmission).where(*cond).group_by(literal_column("1")).order_by(literal_column("2").desc()).limit(MAX_FACET_VALUES)
            facets[field] = [FacetValue(value=_key(v), count=c) for v, c in (await self.session.execute(stmt)).all()]

        items: list[Any] = []
        if q.rows:
            sort = [(k.field, k.desc) for k in q.sort] or [("created_at", True)]
            stmt = select(FormSubmission).where(*cond).order_by(*jq.order_by(sort), FormSubmission.id).offset((q.page - 1) * q.page_size).limit(q.page_size)
            records = (await self.session.execute(stmt)).scalars().all()
            names = await self._people({r.submitted_by for r in records if r.submitted_by})
            for r in records:
                row = {c: getattr(r, c) for c in ("id", "template_id", "submission_data", "form_metadata", "files_uploaded", "status", "submitted_by", "created_at", "updated_at", "version", "is_deleted", "deleted_at", "row_version") if hasattr(r, c)}
                row["submission_data"] = self._without(row["submission_data"], hidden)
                row["files_uploaded"] = self._without(row.get("files_uploaded"), hidden)
                row["submitted_by_name"] = names.get(r.submitted_by)
                items.append(row)
        return SubmissionQueryResult(items=items, total=total, page=q.page, page_size=q.page_size, aggregates=aggregates, groups=groups, facets=facets)

    async def _people(self, ids: set[UUID]) -> dict[UUID, str]:
        if not ids:
            return {}
        rows = (await self.session.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()
        return {i: (n or e) for i, n, e in rows}

    async def update_submission(self, submission_id: UUID, data: Mapping[str, Any], *, expected_version: int | None = None) -> FormSubmission:
        data = {k: v for k, v in data.items() if k not in ("submitted_by", "template_id", "template_version_id")}
        existing = await self.get(submission_id)
        self._ensure_unlocked(existing)
        if "form_metadata" in data:
            data["form_metadata"] = self._client_metadata(data["form_metadata"])
        hidden = await self._hidden_for(existing.template_id)
        if hidden:  # values of fields the caller cannot see stay as stored; what they send for those fields is ignored
            for key in ("submission_data", "files_uploaded"):
                if data.get(key) is not None:
                    data[key] = {**{k: v for k, v in (getattr(existing, key) or {}).items() if k in hidden}, **self._without(data[key], hidden)}
        if "submission_data" in data:  # an edit is made on the published form: the request now belongs to that version
            current = await self._ensure_template(existing.template_id)
            data["template_version_id"] = self._published_version_id(current)
        if existing.status == DRAFT and data.get("status", DRAFT) != DRAFT:  # a draft is submitted: its form's action runs now
            current = await self._ensure_template(existing.template_id)
            async with self.transaction():
                obj = await self.repo.get(submission_id, for_update=True)
                payload = {"id": obj.id, "status": data["status"], "submission_data": data.get("submission_data", obj.submission_data),
                           "form_metadata": data.get("form_metadata", obj.form_metadata)}
                await self._run_server_action(payload, current, self._published_version_id(current))
                await self.repo.update(obj, {**data, **{k: v for k, v in payload.items() if k != "id"}, "template_version_id": self._published_version_id(current)},
                                       expected_version=expected_version)
            await self.session.refresh(obj)
            return obj
        return await self.update(submission_id, data, expected_version=expected_version)

    async def delete(self, id: UUID) -> None:
        self._ensure_unlocked(await self.get(id))
        await super().delete(id)

    # -- record page ----------------------------------------------------------------------------------------------
    async def record_form(self, submission_id: UUID) -> RecordForm:
        sub = await self.get(submission_id)
        template = await self._ensure_template(sub.template_id)
        version = None
        if sub.template_version_id:
            version = (await self.session.execute(select(TemplateVersion).where(TemplateVersion.id == sub.template_version_id))).scalars().first()
        hidden = await self._hidden_for(template.id)
        live = await live_config(self.session, template)
        return RecordForm(template_id=template.id, name=template.name, form_config=submission_fields.strip_fields(version.form_config if version else live, hidden),
                          versioned=version is not None, current=version is None or version.content_hash == content_hash(live))

    def _mask_changes(self, changes: list[FieldChange], hidden: frozenset[str]) -> list[FieldChange]:
        out = []
        for c in changes:
            if c.field in hidden:
                continue
            if c.field == "files_uploaded":
                c = FieldChange(field=c.field, old=self._without(c.old, hidden) if isinstance(c.old, dict) else c.old, new=self._without(c.new, hidden) if isinstance(c.new, dict) else c.new)
            out.append(c)
        return out

    async def history(self, submission_id: UUID, limit: int = 100) -> list[HistoryEntry]:
        sub = await self.get(submission_id)  # 404 for other tenants' and deleted requests
        hidden = await self._hidden_for(sub.template_id)
        stmt = (select(AuditLog).where(AuditLog.resource_type == "form_submissions", AuditLog.resource_id == str(submission_id), AuditLog.tenant_id == context.tenant_id_var.get())
                .order_by(AuditLog.occurred_at.desc()).limit(limit))
        rows = (await self.session.execute(stmt)).scalars().all()
        names = await self._people({r.actor_id for r in rows if r.actor_id})
        return [HistoryEntry(id=r.id, action=r.action, occurred_at=r.occurred_at, actor_id=r.actor_id, actor_name=names.get(r.actor_id), changes=self._mask_changes(diff_changes(r.changes), hidden)) for r in rows]


async def get_form_submission_service(session: AsyncSession = Depends(get_session)) -> FormSubmissionService:
    return FormSubmissionService(session)
