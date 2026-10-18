"""Cash deposit / withdrawal: the server action behind the cash form, and its approval policy.

The form captures the transaction (account lookup, amounts, depositor); this code is the authority: it checks the account and
the balance again, numbers the transaction, posts it to the core, or, above the approval limit, holds it for a supervisor.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import approval, numbering
from app.foundation.approval.model import ApprovalRequest
from app.foundation.approval.service import ApprovalService
from app.foundation.db.base import utcnow
from app.foundation.errors import Conflict, ValidationFailed
from app.modules.core_banking.models.BankTransaction import DEPOSIT, PENDING_APPROVAL, POSTED, REJECTED, BankTransaction
from app.modules.core_banking.models.LedgerEntry import CREDIT, DEBIT
from app.modules.core_banking.services.gateway import account_not_found, check_postable, gateway
from app.modules.core_banking.settings import get_core_banking_settings
from app.modules.form_submission.services.server_actions import ActionContext, ActionResult, register_server_action, settle_submission

ACTION = "core_banking.cash_transaction"
POLICY = "bank_txn.post"
SEQUENCE = "bank_txn"

numbering.register(SEQUENCE, title="Teller transactions", pattern="TXN-{yyyy}-{seq:06}", reset="yearly")


class CashTransactionInput(BaseModel):
    """The values of the cash form this action reads (form field ids are the aliases)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_number: str = Field(alias="accountNumber", pattern=r"^\d{6,34}$", description="The account to post to")
    transaction_type: Literal["deposit", "withdrawal"] = Field(alias="transactionType", description="deposit or withdrawal")
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2, description="In the account's currency")
    narration: str = Field(min_length=1, max_length=140, description="Shown on the customer's statement")
    depositor_name: str | None = Field(None, alias="depositorName", max_length=200, description="Who brings the cash (deposits)")
    depositor_phone: str | None = Field(None, alias="depositorPhone", max_length=40, description="Depositor's phone (deposits)")

    @model_validator(mode="after")
    def _depositor(self) -> "CashTransactionInput":
        if self.transaction_type == DEPOSIT and not (self.depositor_name or "").strip():
            raise ValidationFailed("Some values are not valid", code="invalid_submission",
                                   errors=[{"field": "depositorName", "message": "Say who brings the cash"}])
        return self


def _direction(txn_type: str) -> Literal["credit", "debit"]:
    return CREDIT if txn_type == DEPOSIT else DEBIT


async def _post(session: AsyncSession, txn: BankTransaction) -> Decimal:
    balance = await gateway(session).post(account_number=txn.account_number, direction=_direction(txn.type), amount=Decimal(txn.amount),
                                          currency=txn.currency, reference=txn.reference, narration=txn.narration)
    txn.status, txn.balance_after, txn.posted_at = POSTED, balance, utcnow()
    await session.flush()
    return balance


def _money(v: Decimal) -> float:
    return float(round(v, 2))


async def cash_transaction(session: AsyncSession, ctx: ActionContext) -> ActionResult:
    data: CashTransactionInput = ctx.input  # type: ignore[assignment]
    account = await gateway(session).get_account(data.account_number)
    if account is None:
        raise account_not_found()
    check_postable(account, direction=_direction(data.transaction_type), amount=data.amount)

    txn = BankTransaction(reference=await numbering.next_number(session, SEQUENCE), type=data.transaction_type, account_number=account.number,
                          amount=data.amount, currency=account.currency, narration=data.narration.strip(), depositor_name=data.depositor_name,
                          depositor_phone=data.depositor_phone, status=PENDING_APPROVAL, submission_id=ctx.submission_id)
    session.add(txn)
    await session.flush()

    if data.amount > get_core_banking_settings().approval_limit:
        await ApprovalService(session).submit(POLICY, resource_type="bank_transactions", resource_id=str(txn.id),
                                              title=f"{data.transaction_type.title()} {data.amount:,.2f} {account.currency} · {account.number} {account.holder_name}",
                                              payload={"reference": txn.reference, "amount": str(data.amount), "currency": account.currency, "account": account.number})
        return ActionResult(status="submitted", data={"reference": txn.reference, "postingStatus": "Awaiting approval"})

    balance = await _post(session, txn)
    return ActionResult(status="completed", data={"reference": txn.reference, "postingStatus": "Posted", "balanceAfter": _money(balance)})


register_server_action(ACTION, title="Post a cash deposit or withdrawal", permission="bank_txn:create", input_model=CashTransactionInput,
                       handler=cash_transaction,
                       description="Checks the account and balance, numbers the transaction and posts it to the core; above the approval limit a supervisor approves first.")


# -- approval: a supervisor decides transactions above the limit; the effect runs in the decision's transaction ---------------
async def _pending(session: AsyncSession, request: ApprovalRequest) -> BankTransaction:
    stmt = select(BankTransaction).where(BankTransaction.id == uuid.UUID(request.resource_id)).with_for_update()
    txn = (await session.execute(stmt)).scalars().first()
    if txn is None or txn.status != PENDING_APPROVAL:
        raise Conflict("This transaction is no longer waiting for approval", code="transaction_not_pending")
    return txn


async def _on_approved(session: AsyncSession, request: ApprovalRequest) -> None:
    txn = await _pending(session, request)
    balance = await _post(session, txn)  # checks the account and balance again: refused postings must be rejected instead
    if txn.submission_id:
        await settle_submission(session, txn.submission_id, status="completed", data={"postingStatus": "Posted", "balanceAfter": _money(balance)})


async def _on_closed(session: AsyncSession, request: ApprovalRequest) -> None:
    txn = await _pending(session, request)
    txn.status = REJECTED
    await session.flush()
    if txn.submission_id:
        withdrawn = request.status == "cancelled"
        await settle_submission(session, txn.submission_id, status="failed", data={"postingStatus": "Withdrawn" if withdrawn else "Rejected"})


approval.register_policy(POLICY, title="Post a teller transaction above the limit", approver_permission="bank_txn:approve",
                         on_approved=_on_approved, on_rejected=_on_closed, on_cancelled=_on_closed)
