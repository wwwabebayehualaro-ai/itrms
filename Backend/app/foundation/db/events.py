"""Session-level guarantees applied to *every* session, whether or not feature code uses the repository:

* tenant guard  - SELECT/UPDATE/DELETE on tenant-scoped entities are filtered by the current tenant; new rows get it
                  stamped; writing another tenant's id is rejected.
* actor stamping - created_by / updated_by come from the request context.
* audit trail   - create/update/delete of audited entities write AuditLog rows in the same transaction.
* immutability  - audit rows can never be modified or removed through the ORM.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session, with_loader_criteria

from app.foundation import context
from app.foundation.audit.model import AuditLog
from app.foundation.audit.service import build_entry
from app.foundation.db.base import Base, SoftDeleteMixin, TenantMixin, utcnow
from app.foundation.errors import Forbidden

MAX_JSON_AUDIT_BYTES = 64 * 1024
_installed = False
_NO_TENANT = uuid.UUID(int=0)  # matches nothing: outside a tenant/bypass context tenant data is invisible (fail closed)


def _jsonable(value: Any) -> Any:
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} bytes>"
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    return value


def _summarize(value: Any) -> Any:
    value = _jsonable(value)
    if isinstance(value, (dict, list)):
        raw = json.dumps(value, sort_keys=True, default=str)
        if len(raw) > MAX_JSON_AUDIT_BYTES:
            return {"_truncated": True, "bytes": len(raw), "sha256": hashlib.sha256(raw.encode()).hexdigest()}
    return value


def _diff(obj: Base, *, created: bool) -> dict[str, Any]:
    state, redact, out = inspect(obj), obj.__audit_redact__, {}
    for attr in state.mapper.column_attrs:
        if attr.key in ("row_version", "updated_at", "updated_by") or attr.key in obj.__audit_ignore__:
            continue
        hist = state.attrs[attr.key].history
        if created:
            new = getattr(obj, attr.key, None)
            if new is not None:
                out[attr.key] = {"new": "***" if attr.key in redact else _summarize(new)}
        elif hist.has_changes():
            old = hist.deleted[0] if hist.deleted else None
            new = hist.added[0] if hist.added else None
            out[attr.key] = {"old": "***", "new": "***"} if attr.key in redact else {"old": _summarize(old), "new": _summarize(new)}
    return out


def install_session_hooks() -> None:
    global _installed
    if _installed:
        return
    _installed = True

    @event.listens_for(Session, "do_orm_execute")
    def _tenant_filter(state):  # noqa: ANN001
        if context.tenant_bypass_var.get() or state.is_column_load or state.is_relationship_load:
            return
        tenant_id = context.tenant_id_var.get()
        if not (state.is_select or state.is_update or state.is_delete):
            return
        # Fail closed: outside a bypass, tenant-scoped tables are only readable with a tenant in context.
        scope_id = tenant_id or _NO_TENANT
        state.statement = state.statement.options(
            with_loader_criteria(TenantMixin, lambda cls: cls.tenant_id == scope_id, include_aliases=True, propagate_to_loaders=True)
        )

    @event.listens_for(Session, "before_flush")
    def _before_flush(session: Session, flush_context, instances):  # noqa: ANN001
        tenant_id, actor_id = context.tenant_id_var.get(), context.actor_id_var.get()
        bypass = context.tenant_bypass_var.get()
        entries: list[AuditLog] = []

        for obj in session.new:
            if isinstance(obj, AuditLog):
                continue
            if getattr(obj, "id", "missing") is None:
                obj.id = uuid.uuid4()
            if isinstance(obj, TenantMixin):
                if obj.tenant_id is None:
                    if tenant_id is None:
                        raise Forbidden("No tenant in context; cannot create tenant-scoped data", code="tenant_required")
                    obj.tenant_id = tenant_id
                elif not bypass and obj.tenant_id != tenant_id:
                    raise Forbidden("Cross-tenant write rejected", code="tenant_mismatch")
            if hasattr(obj, "created_by") and obj.created_by is None:
                obj.created_by = actor_id
            if obj.__audited__:
                entries.append(build_entry("create", obj.__tablename__, str(obj.id), changes=_diff(obj, created=True),
                                           tenant_id=getattr(obj, "tenant_id", None)))

        for obj in session.dirty:
            if isinstance(obj, AuditLog):
                raise Forbidden("Audit records are immutable", code="audit_immutable")
            if not session.is_modified(obj, include_collections=False):
                continue
            if isinstance(obj, TenantMixin) and not bypass and obj.tenant_id != tenant_id:
                raise Forbidden("Cross-tenant write rejected", code="tenant_mismatch")
            if hasattr(obj, "updated_by"):
                obj.updated_by = actor_id
            if obj.__audited__:
                changes = _diff(obj, created=False)
                if not changes:
                    continue
                action = "delete" if isinstance(obj, SoftDeleteMixin) and "deleted_at" in changes and obj.deleted_at is not None else "update"
                entries.append(build_entry(action, obj.__tablename__, str(obj.id), changes=changes, tenant_id=getattr(obj, "tenant_id", None)))

        for obj in session.deleted:
            if isinstance(obj, AuditLog):
                raise Forbidden("Audit records are immutable", code="audit_immutable")
            if obj.__audited__:
                entries.append(build_entry("hard_delete", obj.__tablename__, str(getattr(obj, "id", "")), changes=_diff(obj, created=True),
                                           tenant_id=getattr(obj, "tenant_id", None)))

        for entry in entries:
            session.add(entry)

    @event.listens_for(Session, "after_begin")
    def _pg_tenant_setting(session, transaction, connection):  # noqa: ANN001
        """Expose the tenant to PostgreSQL so row-level-security policies (defence in depth, see rls.py) can use it."""
        if connection.dialect.name != "postgresql":
            return
        tid = context.tenant_id_var.get()
        connection.execute(
            text("SELECT set_config('app.tenant_id', :tenant, true), set_config('app.bypass_rls', :bypass, true)"),
            {"tenant": str(tid) if tid else "", "bypass": "on" if context.tenant_bypass_var.get() else "off"},
        )
