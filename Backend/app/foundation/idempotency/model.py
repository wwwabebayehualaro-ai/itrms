from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import Base, IdMixin, TenantMixin, TimestampMixin
from app.foundation.db.types import GUID, JSONType


class IdempotencyRecord(IdMixin, TenantMixin, TimestampMixin, Base):
    """The outcome of one idempotent command (or the marker that it is running). Short-lived; purged after expiry."""

    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("tenant_id", "actor_id", "key", name="uq_idempotency_records_tenant_actor_key"),)

    actor_id: Mapped[uuid.UUID] = mapped_column(GUID)
    key: Mapped[str] = mapped_column(String(255))
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(500))
    request_hash: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(16), default="running")  # running | done
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict | list | None] = mapped_column(JSONType, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
