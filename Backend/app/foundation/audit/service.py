"""Explicit audit events for things that are not row changes (login, permission denial, exports, ...).

Row changes (create/update/delete on audited models) are captured automatically by the session hooks.
"""
from __future__ import annotations

import logging

from app.foundation import context
from app.foundation.audit.model import AuditLog
from app.foundation.db.session import get_database
from app.foundation.observability import metrics

log = logging.getLogger("app.audit")


def build_entry(action: str, resource_type: str, resource_id: str | None = None, *, outcome: str = "success", changes: dict | None = None,
                tenant_id=None, actor_id=None) -> AuditLog:
    ctx = context.current()
    metrics.AUDIT_EVENTS.labels(action).inc()
    return AuditLog(
        tenant_id=tenant_id or ctx.tenant_id, actor_id=actor_id or ctx.actor_id, request_id=ctx.request_id, client_ip=ctx.client_ip,
        user_agent=ctx.user_agent, action=action, resource_type=resource_type, resource_id=resource_id, outcome=outcome, changes=changes,
    )


async def record_event(action: str, resource_type: str, resource_id: str | None = None, *, outcome: str = "success", changes: dict | None = None,
                       tenant_id=None, actor_id=None, session=None) -> None:
    """Write an audit record. Without a session it uses its own short transaction so it survives a rolled-back request
    (e.g. a denied action must still be recorded)."""
    entry = build_entry(action, resource_type, resource_id, outcome=outcome, changes=changes, tenant_id=tenant_id, actor_id=actor_id)
    if session is not None:
        session.add(entry)
        return
    try:
        async with get_database().sessionmaker() as own:
            own.add(entry)
            await own.commit()
    except Exception:  # noqa: BLE001 - auditing must never take the request down; the failure itself is logged loudly
        log.exception("failed to persist audit event", extra={"audit_action": action, "resource_type": resource_type})
