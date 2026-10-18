"""Approval policies: declared in code by the module that owns the resource (decisions have effects; effects are code)."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.foundation.approval.model import ApprovalRequest

DecisionHook = Callable[["AsyncSession", "ApprovalRequest"], Awaitable[None]]


@dataclass(frozen=True)
class ApprovalPolicy:
    key: str
    title: str
    #: who may decide (on top of: never the maker, unless `allow_self_approval`)
    approver_permission: str
    #: run inside the decision's transaction; raise an AppError to refuse the decision (nothing is saved then)
    on_approved: DecisionHook | None = None
    on_rejected: DecisionHook | None = None
    on_cancelled: DecisionHook | None = None
    allow_self_approval: bool = False


_policies: dict[str, ApprovalPolicy] = {}


def register_policy(key: str, *, title: str, approver_permission: str, on_approved: DecisionHook | None = None,
                    on_rejected: DecisionHook | None = None, on_cancelled: DecisionHook | None = None,
                    allow_self_approval: bool = False) -> ApprovalPolicy:
    policy = ApprovalPolicy(key, title, approver_permission, on_approved, on_rejected, on_cancelled, allow_self_approval)
    _policies[key] = policy  # re-registration (module reload, tests) replaces the hooks
    return policy


def get_policy(key: str) -> ApprovalPolicy | None:
    return _policies.get(key)


def policies() -> list[ApprovalPolicy]:
    return list(_policies.values())
