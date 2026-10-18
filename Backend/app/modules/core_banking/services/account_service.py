from __future__ import annotations

from decimal import Decimal

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.db.pagination import Page, PageParams
from app.foundation.db.repository import CrudService, Repository
from app.foundation.db.session import get_session
from app.foundation.errors import Conflict, NotFound
from app.modules.core_banking.models.Account import Account
from app.modules.core_banking.models.BankTransaction import BankTransaction
from app.modules.core_banking.models.LedgerEntry import CREDIT, LedgerEntry
from app.modules.core_banking.schemas.core_banking_schema import AccountCreate, AccountOut
from app.modules.core_banking.services.gateway import AccountView, gateway


def account_out(a: AccountView | Account) -> AccountOut:
    balance = a.available_balance if isinstance(a, AccountView) else a.balance
    return AccountOut(number=a.number, holder_name=a.holder_name, branch=a.branch, currency=a.currency, status=a.status,  # type: ignore[arg-type]
                      available_balance=float(balance))


class AccountRepository(Repository[Account]):
    model = Account
    resource_name = "Account"
    filterable = frozenset({"status"})
    sortable = frozenset({"number", "holder_name", "created_at"})


class TransactionRepository(Repository[BankTransaction]):
    model = BankTransaction
    resource_name = "Transaction"
    filterable = frozenset({"account_number", "status"})
    sortable = frozenset({"created_at", "reference", "amount"})


class AccountService(CrudService[Account]):
    repository_class = AccountRepository

    async def lookup(self, number: str) -> AccountOut:
        account = await gateway(self.session).get_account(number)
        if account is None:
            raise NotFound("Account not found", code="account_not_found")
        return account_out(account)

    async def accounts(self, params: PageParams, *, status: str | None = None, sort: str | None = None) -> Page[Account]:
        return await self.repo.list(params=params, filters={"status": status}, sort=sort or "number")

    async def transactions(self, params: PageParams, *, account_number: str | None = None, status: str | None = None,
                           sort: str | None = None) -> Page[BankTransaction]:
        return await TransactionRepository(self.session).list(params=params, filters={"account_number": account_number, "status": status},
                                                              sort=sort or "-created_at")

    async def open_account(self, body: AccountCreate) -> Account:
        """Simulation only: a real core opens accounts itself."""
        async with self.transaction():
            if await gateway(self.session).get_account(body.number) is not None:
                raise Conflict("An account with this number exists", code="account_exists")
            account = await self.repo.add({**body.model_dump(exclude={"opening_balance"}), "balance": body.opening_balance})
            if body.opening_balance > Decimal("0"):
                self.session.add(LedgerEntry(account_id=account.id, reference="OPENING", direction=CREDIT, amount=body.opening_balance,
                                             balance_after=body.opening_balance, narration="Opening balance"))
        await self.session.refresh(account)
        return account


async def get_account_service(session: AsyncSession = Depends(get_session)) -> AccountService:
    return AccountService(session)
