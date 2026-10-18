from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import Base, utcnow
from app.foundation.db.types import GUID, JSONType


class AuditLog(Base):
    """Append-only record of who did what, when, from where, and what changed.

    Updates/deletes are rejected by the ORM guard (see events.py) and, on PostgreSQL, by a trigger
    installed by migration `0001_platform_baseline`.
    """

    __tablename__ = "audit_logs"
    __audited__ = False

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow, index=True)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)  # create | update | delete | auth.login | authz.denied | ...
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), default="success")
    changes: Mapped[dict | None] = mapped_column(JSONType, nullable=True)

    __table_args__ = (
        Index("ix_audit_logs_tenant_time", "tenant_id", "occurred_at"),
        Index("ix_audit_logs_resource", "resource_type", "resource_id"),
    )
