from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status

from app.foundation.auth.schemas import DirectoryEntry, LoginRequest, PasswordChange, RefreshRequest, TokenPair, UserCreate, UserOut
from app.foundation.auth.service import AuthService
from app.foundation import context
from app.foundation.config import get_settings
from app.foundation.db.pagination import Page, PageParams, page_params
from app.foundation.db.session import get_session
from app.foundation.security import permissions
from app.foundation.security.deps import get_principal, get_token_service, require, secure_router
from app.foundation.security.principal import Principal
from app.foundation.security.ratelimit import RateLimiter

permissions.register("user", sensitive=True)  # account data: admin only, not reachable via viewer/editor wildcards
permissions.register("directory", ["read"])
# people pickers: admin/editor/viewer read the directory through their wildcards, application roles grant `directory:read`;
# the entries carry no roles or account state

public = APIRouter(prefix="/auth", tags=["auth"])
protected = secure_router(prefix="/auth", tags=["auth"])

_login_limiter = RateLimiter(limit=20, window_seconds=60)


def get_auth_service(session=Depends(get_session), tokens=Depends(get_token_service)) -> AuthService:
    return AuthService(session, tokens, get_settings())


@public.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, svc: AuthService = Depends(get_auth_service)):
    _login_limiter.hit(f"{context.client_ip_var.get()}|{body.email.lower()}")
    return await svc.login(body.email, body.password)


@public.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, svc: AuthService = Depends(get_auth_service)):
    return await svc.refresh(body.refresh_token)


@public.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, svc: AuthService = Depends(get_auth_service)):
    await svc.logout(body.refresh_token)
    return Response(status_code=204)


@protected.get("/me", response_model=UserOut)
async def me(principal: Principal = Depends(get_principal), svc: AuthService = Depends(get_auth_service)):
    user = UserOut.model_validate(await svc.get(principal.user_id))
    # concrete permissions, so the UI needs no knowledge of wildcards or sensitive resources
    user.permissions = sorted(p for p in permissions.registered() if principal.can(p))
    return user


@protected.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: PasswordChange, principal: Principal = Depends(get_principal), svc: AuthService = Depends(get_auth_service)):
    await svc.change_password(principal, body.current_password, body.new_password)
    return Response(status_code=204)


@protected.get("/directory", response_model=list[DirectoryEntry], dependencies=[Depends(require("directory:read"))], summary="People picker: active colleagues of the tenant")
async def directory(q: str | None = Query(None, max_length=100, description="Filter by name or email"), limit: int = Query(200, ge=1, le=500), svc: AuthService = Depends(get_auth_service)):
    return await svc.directory(q, limit)


@protected.get("/roles", response_model=list[str], dependencies=[Depends(require("template:update"))], summary="Role names (for choosing who may see a form field)")
async def roles() -> list[str]:
    return sorted(permissions.known_roles())


@protected.get("/users", response_model=Page[UserOut], dependencies=[Depends(require("user:read"))])
async def list_users(params: PageParams = Depends(page_params), svc: AuthService = Depends(get_auth_service)):
    return await svc.list(params)


@protected.post("/users", response_model=UserOut, status_code=201, dependencies=[Depends(require("user:create"))])
async def create_user(body: UserCreate, svc: AuthService = Depends(get_auth_service)):
    return await svc.create_user(email=body.email, password=body.password, full_name=body.full_name, roles=body.roles)
