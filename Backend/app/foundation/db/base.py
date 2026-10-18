"""Base class and mixins every entity builds on.

A feature model is just:

    class Invoice(EntityBase):
        __tablename__ = "invoices"
        number: Mapped[str] = mapped_column(String(50))

and automatically gets: uuid pk, tenant scoping (enforced on every query), created/updated timestamps and actors,
soft delete, optimistic locking and an audit trail. Opt out per class with `__audited__ = False`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

from app.foundation.db.types import GUID

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)

    #: audit trail on/off for this model
    __audited__: bool = False
    #: columns whose values are never written to the audit log
    __audit_redact__: frozenset[str] = frozenset({"password_hash"})
    #: columns that change too often to be worth auditing (counters, last-seen timestamps)
    __audit_ignore__: frozenset[str] = frozenset()

    def to_dict(self, exclude: set[str] | None = None) -> dict[str, Any]:
        return {c.key: getattr(self, c.key) for c in self.__mapper__.column_attrs if not exclude or c.key not in exclude}


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=utcnow)


class ActorMixin:
    created_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class TenantMixin:
    """Row-level tenancy. `tenant_id` is filled from the request context and filtered on every query by the tenant guard."""

    @declared_attr
    def tenant_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(GUID, ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)


class VersionedMixin:
    """Optimistic locking: concurrent writers get a 409 instead of silently overwriting each other."""

    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:  # noqa: N805
        return {"version_id_col": cls.row_version}


class EntityBase(IdMixin, TenantMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, VersionedMixin, Base):
    """The base for feature entities."""

    __abstract__ = True
    __audited__ = True
