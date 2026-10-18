"""/platform/modules (the caller's menu and flags) and /platform/flags (admin: switch modules and features per tenant)."""
from __future__ import annotations

from fastapi import Depends
from pydantic import BaseModel, Field

from app.foundation.registry import flags, registry
from app.foundation.registry.service import FlagService, get_flag_service
from app.foundation.security import permissions
from app.foundation.security.deps import get_principal, require, secure_router
from app.foundation.security.principal import Principal

permissions.register("feature_flag", ["read", "update"], sensitive=True)

router = secure_router(prefix="/platform", tags=["platform"])


class NavItemOut(BaseModel):
    label: str
    route: str | None = None
    icon: str | None = None
    slot: str | None = None
    children: list[NavItemOut] = Field(default_factory=list)


class NavGroupOut(BaseModel):
    title: str
    items: list[NavItemOut]


class ModuleOut(BaseModel):
    key: str
    title: str
    kind: str
    description: str


class ModulesOut(BaseModel):
    modules: list[ModuleOut] = Field(description="Enabled modules")
    nav: list[NavGroupOut] = Field(description="Menu of the enabled modules, filtered by the caller's permissions")
    flags: dict[str, bool] = Field(description="Effective value of every feature flag for the caller's tenant")


class FlagOut(BaseModel):
    key: str
    description: str
    kind: str
    default: bool
    enabled: bool
    overridden: bool
    locked: bool


class FlagUpdate(BaseModel):
    enabled: bool | None = Field(description="true/false overrides the default for this tenant; null goes back to the default")


@router.get("/modules", response_model=ModulesOut, summary="Enabled modules, the caller's menu and the tenant's feature flags")
async def modules(principal: Principal = Depends(get_principal), svc: FlagService = Depends(get_flag_service)):
    values = await svc.values()
    enabled = {m.key for m in registry.modules() if values.get(m.flag_key)}
    return ModulesOut(
        modules=[ModuleOut(key=m.key, title=m.title, kind=m.kind, description=m.description) for m in registry.modules() if m.key in enabled],
        nav=registry.navigation(enabled, principal.can),
        flags=values,
    )


async def _flag_out(svc: FlagService, key: str) -> FlagOut:
    d = flags.definition(key)
    values, overrides = await svc.values(), await svc.overrides()
    return FlagOut(key=d.key, description=d.description, kind=d.kind, default=d.default, enabled=values[d.key], overridden=d.key in overrides, locked=d.locked)


@router.get("/flags", response_model=list[FlagOut], dependencies=[Depends(require("feature_flag:read"))], summary="All feature flags with defaults and tenant overrides")
async def list_flags(svc: FlagService = Depends(get_flag_service)):
    return [await _flag_out(svc, d.key) for d in flags.definitions()]


@router.put("/flags/{key}", response_model=FlagOut, dependencies=[Depends(require("feature_flag:update"))], summary="Switch a module or feature for this tenant")
async def update_flag(key: str, body: FlagUpdate, svc: FlagService = Depends(get_flag_service)):
    await svc.set(key, body.enabled)
    return await _flag_out(svc, key)
