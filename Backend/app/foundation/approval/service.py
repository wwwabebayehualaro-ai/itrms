from __future__ import annotations

import uuid
from typing import Any

from fastapi import Depends
from sqlalchemy import ColumnElement, and_, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation import context
from app.foundation.approval.model import APPROVED, CANCELLED, PENDING, REJECTED, ApprovalRequest
from app.foundation.approval.policy import ApprovalPolicy, get_policy, policies
from app.foundation.audit.service import record_event
from app.foundation.auth.models import User
from app.foundation.db.base import utcnow
from app.foundation.db.pagination import Page, PageParams
from app.foundation.db.repository import Repository
from app.foundation.db.session import get_session
from app.foundation.errors import BadRequest, Conflict, Forbidden, NotFound, ValidationFailed
from app.foundation.security.principal import Principal

RESOURCE = "approval_requests"


class ApprovalRepository(Repository[ApprovalRequest]):
    model = ApprovalRequest
    resource_name = "Approval request"
    filterable = frozenset({"status", "policy", "resource_type", "resource_id"})
    sortable = frozenset({"created_at", "updated_at", "decided_at"})


def _policy(key: str) -> ApprovalPolicy:
    policy = get_policy(key)
    if policy is None:
        raise BadRequest(f"Unknown approval policy '{key}'", code="unknown_policy")
    return policy


class ApprovalService:
    """Submit (inside the caller's transaction) and decide (own transaction, policy hook included) approval requests."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ApprovalRepository(session)

    # -- maker side --------------------------------------------------------------------------------------------------
    async def submit(self, policy: str, *, resource_type: str, resource_id: str, title: str, payload: dict[str, Any] | None = None,
                     note: str | None = None) -> ApprovalRequest:
        """Open a request. Flushes only: the calling service commits it together with its own change."""
        _policy(policy)
        if await self.pending_for(policy, resource_id) is not None:
            raise Conflict("An approval request for this is already open", code="approval_pending")
        actor = context.actor_id_var.get()
        if actor is None:
            raise Forbidden("An approval request needs a signed-in requester")
        request = await self.repo.add({"policy": policy, "resource_type": resource_type, "resource_id": resource_id, "title": title[:255],
                                       "payload": payload, "note": note, "requested_by": actor, "status": PENDING})
        await record_event("approval.requested", RESOURCE, str(request.id), changes={"policy": policy, "resource_id": resource_id}, session=self.session)
        return request

    async def pending_for(self, policy: str, resource_id: str) -> ApprovalRequest | None:
        stmt = self.repo._select().where(ApprovalRequest.policy == policy, ApprovalRequest.resource_id == resource_id, ApprovalRequest.status == PENDING)
        return (await self.session.execute(stmt)).scalars().first()

    # -- checker side ------------------------------------------------------------------------------------------------
    def can_decide(self, request: ApprovalRequest, principal: Principal) -> bool:
        policy = get_policy(request.policy)
        return (request.status == PENDING and policy is not None and principal.can(policy.approver_permission)
                and (policy.allow_self_approval or request.requested_by != principal.user_id))

    async def _locked_pending(self, id: uuid.UUID, expected_version: int | None) -> ApprovalRequest:
        request = await self.repo.get(id, for_update=True)
        if expected_version is not None and request.row_version != expected_version:
            raise Conflict("The request was changed by someone else. Reload and retry.", code="version_conflict")
        if request.status != PENDING:
            raise Conflict(f"This request is already {request.status}", code="approval_not_pending")
        return request

    async def _decide(self, id: uuid.UUID, principal: Principal, status: str, comment: str | None, expected_version: int | None) -> ApprovalRequest:
        try:
            request = await self._locked_pending(id, expected_version)
            policy = _policy(request.policy)
            if request.requested_by == principal.user_id and not policy.allow_self_approval:
                raise Forbidden("The person who asked cannot approve or reject their own request", code="self_approval")
            if not principal.can(policy.approver_permission):
                await record_event("authz.denied", RESOURCE, str(id), outcome="denied", session=None)
                raise Forbidden("You may not decide this request")
            await self.repo.update(request, {"status": status, "decided_by": principal.user_id, "decided_at": utcnow(), "comment": comment})
            hook = policy.on_approved if status == APPROVED else policy.on_rejected
            if hook is not None:
                await hook(self.session, request)  # same transaction: the decision and its effect commit together
            await record_event(f"approval.{status}", RESOURCE, str(id), changes={"policy": request.policy, "resource_id": request.resource_id}, session=self.session)
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            raise
        await self.session.refresh(request)
        return request

    async def approve(self, id: uuid.UUID, principal: Principal, *, comment: str | None = None, expected_version: int | None = None) -> ApprovalRequest:
        return await self._decide(id, principal, APPROVED, comment or None, expected_version)

    async def reject(self, id: uuid.UUID, principal: Principal, *, comment: str | None, expected_version: int | None = None) -> ApprovalRequest:
        if not (comment or "").strip():
            raise ValidationFailed("Say why the request is rejected", code="comment_required", errors=[{"field": "comment", "message": "A reason is required"}])
        return await self._decide(id, principal, REJECTED, comment.strip(), expected_version)

    async def cancel(self, id: uuid.UUID, principal: Principal, *, expected_version: int | None = None) -> ApprovalRequest:
        try:
            request = await self._locked_pending(id, expected_version)
            if request.requested_by != principal.user_id:
                raise Forbidden("Only the person who asked can withdraw the request")
            await self.repo.update(request, {"status": CANCELLED, "decided_by": principal.user_id, "decided_at": utcnow()})
            policy = get_policy(request.policy)
            if policy and policy.on_cancelled:
                await policy.on_cancelled(self.session, request)
            await record_event("approval.cancelled", RESOURCE, str(id), session=self.session)
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            raise
        await self.session.refresh(request)
        return request

    # -- reading -----------------------------------------------------------------------------------------------------
    def _decidable_by(self, principal: Principal) -> ColumnElement[bool]:
        clauses = []
        for p in policies():
            if principal.can(p.approver_permission):
                own = ApprovalRequest.policy == p.key
                clauses.append(own if p.allow_self_approval else and_(own, ApprovalRequest.requested_by != principal.user_id))
        return or_(*clauses) if clauses else false()

    def _visible_to(self, principal: Principal) -> ColumnElement[bool] | None:
        """Requesters see theirs, deciders the ones they may decide; `approval:read` (admins) sees everything."""
        if principal.can("approval:read"):
            return None
        return or_(ApprovalRequest.requested_by == principal.user_id, self._decidable_by(principal))

    async def visible(self, id: uuid.UUID, principal: Principal) -> ApprovalRequest:
        request = await self.repo.get(id)
        visible = self._visible_to(principal)
        if visible is not None and not (await self.session.execute(select(ApprovalRequest.id).where(ApprovalRequest.id == id, visible))).first():
            raise NotFound("Approval request not found")
        return request

    async def list(self, principal: Principal, *, scope: str, status: str | None, params: PageParams, resource_type: str | None = None,
                   resource_id: str | None = None) -> Page[ApprovalRequest]:
        where: list[ColumnElement[bool]] = []
        if scope == "to_decide":
            where += [self._decidable_by(principal), ApprovalRequest.status == PENDING]
        elif scope == "mine":
            where.append(ApprovalRequest.requested_by == principal.user_id)
        else:  # "all": what the caller may see
            visible = self._visible_to(principal)
            if visible is not None:
                where.append(visible)
        filters = {"status": status, "resource_type": resource_type, "resource_id": resource_id}
        return await self.repo.list(params=params, filters=filters, where=where, sort="-created_at")

    async def people(self, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        ids = {i for i in ids if i}
        if not ids:
            return {}
        rows = (await self.session.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()
        return {r.id: r.full_name or r.email for r in rows}


async def get_approval_service(session: AsyncSession = Depends(get_session)) -> ApprovalService:
    return ApprovalService(session)
