from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID, JSONType

PENDING, APPROVED, REJECTED, CANCELLED = "pending", "approved", "rejected", "cancelled"
STATUSES = (PENDING, APPROVED, REJECTED, CANCELLED)


class ApprovalRequest(EntityBase):
    """A request for a second person's decision on a change (maker-checker). Audited like every entity; decisions also
    write explicit `approval.*` audit events."""

    __tablename__ = "approval_requests"
    __table_args__ = (
        # at most one open request per resource and policy
        Index("uq_approval_requests_open", "tenant_id", "policy", "resource_id", unique=True,
              postgresql_where=text("status = 'pending' AND deleted_at IS NULL"), sqlite_where=text("status = 'pending' AND deleted_at IS NULL")),
        Index("ix_approval_requests_tenant_status", "tenant_id", "status", "created_at"),
    )

    policy: Mapped[str] = mapped_column(String(100), index=True)
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default=PENDING, server_default=PENDING)
    requested_by: Mapped[uuid.UUID] = mapped_column(GUID, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
