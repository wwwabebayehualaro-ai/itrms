from typing import Literal, Optional

from fastapi import Depends, Query, status

from app.foundation.db.pagination import PageParams, page_params
from app.foundation.security import permissions
from app.foundation.security.deps import require, secure_router
from app.modules.core_banking.schemas.core_banking_schema import AccountCreate, AccountOut, AccountPage, TransactionOut, TransactionPage
from app.modules.core_banking.services import cash_transaction  # noqa: F401  (registers the server action and its approval policy)
from app.modules.core_banking.services.account_service import AccountService, account_out, get_account_service

# money and customer data: never reachable through *:read / *:create wildcards; roles name them
permissions.register("account", ["read", "create"], sensitive=True)
permissions.register("bank_txn", ["create", "read", "approve"], sensitive=True)
_FILL = ["template:read", "submission:create", "submission:read", "file:create", "file:read", "directory:read", "view:create", "view:read", "view:update"]
permissions.define_role("teller", [*_FILL, "account:read", "bank_txn:create", "bank_txn:read"])
permissions.define_role("teller_supervisor", [*_FILL, "account:read", "bank_txn:read", "bank_txn:approve"])

router = secure_router(prefix="/core-banking", tags=["Core banking"])


@router.get("/accounts/{number}", response_model=AccountOut, summary="Look up an account (holder, branch, currency, status, available balance)",
            dependencies=[Depends(require("account:read"))])
async def lookup_account(number: str, svc: AccountService = Depends(get_account_service)):
    return await svc.lookup(number)


@router.get("/accounts", response_model=AccountPage, summary="List accounts", dependencies=[Depends(require("account:read"))])
async def list_accounts(params: PageParams = Depends(page_params), status_: Optional[Literal["ACTIVE", "DORMANT", "BLOCKED"]] = Query(None, alias="status"),
                        sort: Optional[str] = Query(None, description="number | holder_name | created_at, prefix with - for descending"),
                        svc: AccountService = Depends(get_account_service)):
    page = await svc.accounts(params, status=status_, sort=sort)
    return AccountPage(items=[account_out(a) for a in page.items], total=page.total, page=page.page, page_size=page.page_size)


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED, summary="Open an account in the simulated core (demo data)",
             dependencies=[Depends(require("account:create"))])
async def open_account(body: AccountCreate, svc: AccountService = Depends(get_account_service)):
    return account_out(await svc.open_account(body))


@router.get("/transactions", response_model=TransactionPage, summary="Teller transactions, newest first", dependencies=[Depends(require("bank_txn:read"))])
async def list_transactions(params: PageParams = Depends(page_params), account_number: Optional[str] = None,
                            status_: Optional[Literal["pending_approval", "posted", "rejected"]] = Query(None, alias="status"),
                            sort: Optional[str] = Query(None, description="created_at | reference | amount, prefix with - for descending"),
                            svc: AccountService = Depends(get_account_service)):
    page = await svc.transactions(params, account_number=account_number, status=status_, sort=sort)
    return TransactionPage(items=[TransactionOut.model_validate(t) for t in page.items], total=page.total, page=page.page, page_size=page.page_size)
