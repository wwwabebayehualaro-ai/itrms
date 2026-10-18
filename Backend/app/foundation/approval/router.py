"""/platform/approvals: the inbox (requests to decide, my requests) and the decisions."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import Depends, Query
from pydantic import BaseModel, Field

from app.foundation.approval.model import ApprovalRequest
from app.foundation.approval.policy import get_policy
from app.foundation.approval.service import ApprovalService, get_approval_service
from app.foundation.db.pagination import PageParams, page_params
from app.foundation.idempotency import Idempotency, idempotency
from app.foundation.security import permissions
from app.foundation.security.deps import get_principal, secure_router
from app.foundation.security.principal import Principal

# `approval:read` = see every request of the tenant (audit view). Deciding is governed by each policy's own permission.
permissions.register("approval", ["read"], sensitive=True)

router = secure_router(prefix="/platform/approvals", tags=["approvals"])


class ApprovalOut(BaseModel):
    id: uuid.UUID
    policy: str
    policy_title: str
    resource_type: str
    resource_id: str
    title: str
    status: Literal["pending", "approved", "rejected", "cancelled"]
    note: str | None = None
    payload: dict[str, Any] | None = None
    requested_by: uuid.UUID
    requested_by_name: str | None = None
    created_at: datetime
    decided_by: uuid.UUID | None = None
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    comment: str | None = None
    row_version: int
    can_decide: bool = Field(description="The caller may approve or reject it now")
    can_cancel: bool = Field(description="The caller asked and it is still open")


class ApprovalPage(BaseModel):
    items: list[ApprovalOut]
    total: int
    page: int
    page_size: int


class Decision(BaseModel):
    comment: str | None = Field(None, max_length=2000)
    row_version: int | None = Field(None, description="Send the version you saw to get a 409 if it changed meanwhile")


class Withdrawal(BaseModel):
    row_version: int | None = None


async def _out(svc: ApprovalService, principal: Principal, rows: list[ApprovalRequest]) -> list[ApprovalOut]:
    names = await svc.people({r.requested_by for r in rows} | {r.decided_by for r in rows if r.decided_by})
    out = []
    for r in rows:
        policy = get_policy(r.policy)
        out.append(ApprovalOut(
            id=r.id, policy=r.policy, policy_title=policy.title if policy else r.policy, resource_type=r.resource_type, resource_id=r.resource_id,
            title=r.title, status=r.status, note=r.note, payload=r.payload, requested_by=r.requested_by, requested_by_name=names.get(r.requested_by),
            created_at=r.created_at, decided_by=r.decided_by, decided_by_name=names.get(r.decided_by) if r.decided_by else None, decided_at=r.decided_at,
            comment=r.comment, row_version=r.row_version, can_decide=svc.can_decide(r, principal),
            can_cancel=r.status == "pending" and r.requested_by == principal.user_id,
        ))
    return out


@router.get("", response_model=ApprovalPage, summary="Approval requests: to decide, mine, or all I may see")
async def list_approvals(scope: Literal["to_decide", "mine", "all"] = Query("to_decide"),
                         status: Literal["pending", "approved", "rejected", "cancelled"] | None = Query(None),
                         resource_type: str | None = Query(None, max_length=100), resource_id: str | None = Query(None, max_length=64),
                         params: PageParams = Depends(page_params), principal: Principal = Depends(get_principal),
                         svc: ApprovalService = Depends(get_approval_service)):
    page = await svc.list(principal, scope=scope, status=status, params=params, resource_type=resource_type, resource_id=resource_id)
    return ApprovalPage(items=await _out(svc, principal, page.items), total=page.total, page=page.page, page_size=page.page_size)


@router.get("/{approval_id}", response_model=ApprovalOut)
async def get_approval(approval_id: uuid.UUID, principal: Principal = Depends(get_principal), svc: ApprovalService = Depends(get_approval_service)):
    return (await _out(svc, principal, [await svc.visible(approval_id, principal)]))[0]


@router.post("/{approval_id}/approve", response_model=ApprovalOut, summary="Approve (never your own request); runs the policy's effect")
async def approve(approval_id: uuid.UUID, body: Decision, principal: Principal = Depends(get_principal), svc: ApprovalService = Depends(get_approval_service),
                  idem: Idempotency = Depends(idempotency())):
    async def decide():
        await svc.visible(approval_id, principal)
        request = await svc.approve(approval_id, principal, comment=body.comment, expected_version=body.row_version)
        return (await _out(svc, principal, [request]))[0]

    return await idem.run(decide)


@router.post("/{approval_id}/reject", response_model=ApprovalOut, summary="Reject with a reason")
async def reject(approval_id: uuid.UUID, body: Decision, principal: Principal = Depends(get_principal), svc: ApprovalService = Depends(get_approval_service),
                 idem: Idempotency = Depends(idempotency())):
    async def decide():
        await svc.visible(approval_id, principal)
        request = await svc.reject(approval_id, principal, comment=body.comment, expected_version=body.row_version)
        return (await _out(svc, principal, [request]))[0]

    return await idem.run(decide)


@router.post("/{approval_id}/cancel", response_model=ApprovalOut, summary="Withdraw your own open request")
async def cancel(approval_id: uuid.UUID, body: Withdrawal, principal: Principal = Depends(get_principal), svc: ApprovalService = Depends(get_approval_service)):
    await svc.visible(approval_id, principal)
    request = await svc.cancel(approval_id, principal, expected_version=body.row_version)
    return (await _out(svc, principal, [request]))[0]
