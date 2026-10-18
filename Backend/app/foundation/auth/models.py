from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import Base, EntityBase, IdMixin, TimestampMixin
from app.foundation.db.types import GUID, JSONType


class Tenant(IdMixin, TimestampMixin, Base):
    __tablename__ = "tenants"
    __audited__ = True

    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class User(EntityBase):
    __tablename__ = "users"
    __audit_ignore__ = frozenset({"failed_attempts", "locked_until", "last_login_at"})
    __table_args__ = (Index("uq_users_email", "email", unique=True, postgresql_where=text("deleted_at IS NULL"), sqlite_where=text("deleted_at IS NULL")),)

    email: Mapped[str] = mapped_column(String(320))  # stored lower-case; one account belongs to one tenant
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    roles: Mapped[list] = mapped_column(JSONType, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(IdMixin, TimestampMixin, Base):
    """Server-side state for single-use refresh tokens (rotation + reuse detection)."""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(GUID, index=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(GUID)
    family_id: Mapped[uuid.UUID] = mapped_column(GUID, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    created_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
