from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.foundation.db.base import EntityBase
from app.foundation.db.types import GUID

DEPOSIT, WITHDRAWAL = "deposit", "withdrawal"
PENDING_APPROVAL, POSTED, REJECTED = "pending_approval", "posted", "rejected"


class BankTransaction(EntityBase):
    """A teller transaction: what was asked (the request of the cash form) and what became of it."""

    __tablename__ = "bank_transactions"

    reference: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[str] = mapped_column(String(20))
    account_number: Mapped[str] = mapped_column(String(34), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    narration: Mapped[str] = mapped_column(String(140))
    depositor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    depositor_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    #: the request (form submission) this transaction was made from
    submission_id: Mapped[uuid.UUID | None] = mapped_column(GUID, nullable=True, unique=True)
    balance_after: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
