from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID

CREDIT, DEBIT = "credit", "debit"


class LedgerEntry(EntityBase):
    """One movement on an account of the simulated core (append-only: entries are never changed)."""

    __tablename__ = "bank_ledger_entries"

    account_id: Mapped[uuid.UUID] = mapped_column(GUID, index=True)
    reference: Mapped[str] = mapped_column(String(40), index=True)
    direction: Mapped[str] = mapped_column(String(10))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    narration: Mapped[str] = mapped_column(String(140))
