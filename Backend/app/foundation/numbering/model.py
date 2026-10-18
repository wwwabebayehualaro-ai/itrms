from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import Base, IdMixin, TenantMixin, TimestampMixin


class NumberSequence(IdMixin, TenantMixin, TimestampMixin, Base):
    """The next number of one sequence for one tenant and period ('' = never resets, '2026' = yearly, '2026-10' = monthly).
    A counter, not a business record: not audited (the documents that take the numbers are)."""

    __tablename__ = "number_sequences"
    __table_args__ = (UniqueConstraint("tenant_id", "key", "period", name="uq_number_sequences_tenant_key_period"),)

    key: Mapped[str] = mapped_column(String(100))
    period: Mapped[str] = mapped_column(String(16), default="", server_default="")
    next_value: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
