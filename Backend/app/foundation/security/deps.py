"""FastAPI security dependencies. Routes are protected by default: build feature routers with `secure_router()`."""
from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.foundation import context
from app.foundation.audit.service import record_event
from app.foundation.config import get_settings
from app.foundation.errors import Forbidden, Unauthorized
from app.foundation.security.principal import Principal
from app.foundation.security.tokens import TokenService

_bearer = HTTPBearer(auto_error=False, description="Access token from POST /auth/login")


@lru_cache
def get_token_service() -> TokenService:
    return TokenService(get_settings())


async def get_principal(creds: HTTPAuthorizationCredentials | None = Depends(_bearer), tokens: TokenService = Depends(get_token_service)) -> Principal:
    if creds is None or creds.scheme.lower() != "bearer":
        raise Unauthorized("Authentication required", code="not_authenticated")
    principal = tokens.decode_access(creds.credentials)
    context.tenant_id_var.set(principal.tenant_id)
    context.actor_id_var.set(principal.user_id)
    context.roles_var.set(principal.roles)
    return principal


def require(*permissions: str):
    """Dependency factory: `principal: Principal = Depends(require("invoice:update"))`. Denials are audited."""

    async def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        missing = [p for p in permissions if not principal.can(p)]
        if missing:
            await record_event("authz.denied", "permission", ",".join(missing), outcome="denied", tenant_id=principal.tenant_id, actor_id=principal.user_id)
            raise Forbidden()
        return principal

    return dependency


def secure_router(**kwargs) -> APIRouter:
    """Router whose every route requires a valid access token (default-deny). Add `require(...)` per endpoint for permissions."""
    deps = list(kwargs.pop("dependencies", []))
    deps.insert(0, Depends(get_principal))
    return APIRouter(dependencies=deps, **kwargs)
