from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AccountOut(BaseModel):
    """What a teller sees of an account (the lookup of the cash form)."""

    number: str
    holder_name: str
    branch: str
    currency: str
    status: Literal["ACTIVE", "DORMANT", "BLOCKED"]
    available_balance: float


class AccountCreate(BaseModel):
    number: str = Field(pattern=r"^\d{6,34}$")
    holder_name: str = Field(min_length=1, max_length=200)
    branch: str = Field(min_length=1, max_length=100)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    status: Literal["ACTIVE", "DORMANT", "BLOCKED"] = "ACTIVE"
    opening_balance: Decimal = Field(Decimal("0"), ge=0, max_digits=16, decimal_places=2)


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    type: str
    account_number: str
    amount: float
    currency: str
    narration: str
    depositor_name: str | None = None
    status: str
    submission_id: uuid.UUID | None = None
    balance_after: float | None = None
    posted_at: datetime | None = None
    created_at: datetime
    created_by: uuid.UUID | None = None


class AccountPage(BaseModel):
    items: list[AccountOut]
    total: int
    page: int
    page_size: int


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int
