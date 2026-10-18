from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase

ACTIVE, DORMANT, BLOCKED = "ACTIVE", "DORMANT", "BLOCKED"


class Account(EntityBase):
    """A customer account of the simulated core banking system (a real core keeps these; see services/gateway.py)."""

    __tablename__ = "bank_accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_bank_accounts_tenant_number"),)

    number: Mapped[str] = mapped_column(String(34), index=True)
    holder_name: Mapped[str] = mapped_column(String(200))
    branch: Mapped[str] = mapped_column(String(100))
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(20), default=ACTIVE)
    balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
