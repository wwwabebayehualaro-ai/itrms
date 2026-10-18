"""The boundary to the core banking system.

Everything else in this module talks to `CoreBankingGateway` only. `SimulatedCoreBanking` keeps accounts and a ledger in this
database so the system can be built and shown without a core; a real core is connected by writing another implementation
(e.g. an HTTP adapter) and returning it from `gateway()`. Implementations raise `AppError`s with the form's field ids
(`accountNumber`, `amount`) so a refusal is shown on the right field.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.errors import ValidationFailed
from app.modules.core_banking.models.Account import ACTIVE, Account
from app.modules.core_banking.models.LedgerEntry import CREDIT, DEBIT, LedgerEntry

Direction = Literal["credit", "debit"]


@dataclass(frozen=True)
class AccountView:
    number: str
    holder_name: str
    branch: str
    currency: str
    status: str
    available_balance: Decimal


class CoreBankingGateway(Protocol):
    async def get_account(self, number: str) -> AccountView | None: ...

    async def post(self, *, account_number: str, direction: Direction, amount: Decimal, currency: str, reference: str, narration: str) -> Decimal:
        """Move money on an account; returns the balance after. Refuses inactive accounts, other currencies and overdrafts."""
        ...


def _refuse(field: str, message: str, code: str) -> ValidationFailed:
    return ValidationFailed(message, code=code, errors=[{"field": field, "message": message}])


def account_not_found() -> ValidationFailed:
    return _refuse("accountNumber", "Account not found", "account_not_found")


def check_postable(account: AccountView, *, direction: Direction, amount: Decimal, currency: str | None = None) -> None:
    if account.status != ACTIVE:
        raise _refuse("accountNumber", f"This account is {account.status.lower()}: no transactions are possible", "account_not_active")
    if currency and currency != account.currency:
        raise _refuse("amount", f"This account is held in {account.currency}", "currency_mismatch")
    if direction == DEBIT and amount > account.available_balance:
        raise _refuse("amount", f"Exceeds the available balance ({account.available_balance:,.2f} {account.currency})", "insufficient_funds")


class SimulatedCoreBanking:
    """Accounts and ledger in this database, locked per account while posting (two tellers cannot overdraw it together)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _account(self, number: str, *, for_update: bool = False) -> Account | None:
        stmt = select(Account).where(Account.number == number, Account.deleted_at.is_(None))
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalars().first()

    @staticmethod
    def _view(a: Account) -> AccountView:
        return AccountView(a.number, a.holder_name, a.branch, a.currency, a.status, Decimal(a.balance))

    async def get_account(self, number: str) -> AccountView | None:
        account = await self._account(number)
        return None if account is None else self._view(account)

    async def post(self, *, account_number: str, direction: Direction, amount: Decimal, currency: str, reference: str, narration: str) -> Decimal:
        account = await self._account(account_number, for_update=True)
        if account is None:
            raise account_not_found()
        check_postable(self._view(account), direction=direction, amount=amount, currency=currency)
        account.balance = Decimal(account.balance) + (amount if direction == CREDIT else -amount)
        self.session.add(LedgerEntry(account_id=account.id, reference=reference, direction=direction, amount=amount,
                                     balance_after=account.balance, narration=narration[:140]))
        await self.session.flush()
        return Decimal(account.balance)


def gateway(session: AsyncSession) -> CoreBankingGateway:
    """The core this system posts to. Replace the simulation here when a real core is connected."""
    return SimulatedCoreBanking(session)
