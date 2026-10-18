"""Per-request ambient context (request id, actor, tenant). Set by middleware/auth, read by logging, audit and the DB layer."""
from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import UUID

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
tenant_id_var: contextvars.ContextVar[UUID | None] = contextvars.ContextVar("tenant_id", default=None)
actor_id_var: contextvars.ContextVar[UUID | None] = contextvars.ContextVar("actor_id", default=None)
# roles of the authenticated caller (empty when unknown: field-level rules then fail closed)
roles_var: contextvars.ContextVar[frozenset[str]] = contextvars.ContextVar("roles", default=frozenset())
client_ip_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("client_ip", default=None)
user_agent_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_agent", default=None)
# When true the tenant guard is off. Only for system jobs (login lookup, CLI); never set from request data.
tenant_bypass_var: contextvars.ContextVar[bool] = contextvars.ContextVar("tenant_bypass", default=False)


@dataclass(frozen=True)
class RequestInfo:
    request_id: str | None
    tenant_id: UUID | None
    actor_id: UUID | None
    client_ip: str | None
    user_agent: str | None


def current() -> RequestInfo:
    return RequestInfo(request_id_var.get(), tenant_id_var.get(), actor_id_var.get(), client_ip_var.get(), user_agent_var.get())


@contextmanager
def system_context():
    """Run trusted platform code across tenants (e.g. authentication before the tenant is known)."""
    token = tenant_bypass_var.set(True)
    try:
        yield
    finally:
        tenant_bypass_var.reset(token)


@contextmanager
def as_actor(tenant_id: UUID | None, actor_id: UUID | None):
    """Scope work to a tenant/actor outside a request (CLI, background jobs, tests)."""
    t1, t2 = tenant_id_var.set(tenant_id), actor_id_var.set(actor_id)
    try:
        yield
    finally:
        tenant_id_var.reset(t1)
        actor_id_var.reset(t2)
