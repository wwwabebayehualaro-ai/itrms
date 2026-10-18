from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.foundation.db.repository import Repository
from app.foundation.db.session import get_session
from app.foundation.errors import Conflict, NotFound
from app.foundation.registry import flags, registry
from app.foundation.registry.model import FeatureFlag
from app.foundation.security.deps import get_principal
from app.foundation.security.principal import Principal


class FeatureFlagRepository(Repository[FeatureFlag]):
    model = FeatureFlag
    resource_name = "Feature flag"


class FlagService:
    """Effective flag values for the current tenant. One query per service instance (i.e. per request)."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = FeatureFlagRepository(session)
        self._overrides: dict[str, bool] | None = None

    async def overrides(self) -> dict[str, bool]:
        if self._overrides is None:
            rows = (await self.session.execute(self.repo._select())).scalars().all()
            self._overrides = {r.key: r.enabled for r in rows}
        return self._overrides

    async def values(self) -> dict[str, bool]:
        """Every defined flag -> effective value. A module is off when its own flag or a module it depends on is off."""
        overrides = await self.overrides()
        out = {d.key: True if d.locked else overrides.get(d.key, d.default) for d in flags.definitions()}
        changed = True
        while changed:  # propagate switched-off dependencies (module graphs are tiny)
            changed = False
            for spec in registry.modules():
                deps = [registry.get(dep) for dep in spec.depends_on]
                if out.get(spec.flag_key) and any(d is not None and not out.get(d.flag_key, False) for d in deps):
                    out[spec.flag_key] = False
                    changed = True
        return out

    async def is_enabled(self, key: str) -> bool:
        if flags.definition(key) is None:
            raise NotFound(f"Unknown feature flag '{key}'", code="unknown_flag")
        return (await self.values())[key]

    async def set(self, key: str, enabled: bool | None) -> None:
        """Override the default for this tenant; `None` removes the override (back to the default)."""
        d = flags.definition(key)
        if d is None:
            raise NotFound(f"Unknown feature flag '{key}'", code="unknown_flag")
        if d.locked:
            raise Conflict(f"'{key}' is part of the platform and cannot be switched off", code="flag_locked")
        row = (await self.session.execute(self.repo._select().where(FeatureFlag.key == key).with_for_update())).scalars().first()
        if enabled is None:
            if row is not None:
                await self.repo.soft_delete(row)
        elif row is None:
            await self.repo.add({"key": key, "enabled": enabled})
        elif row.enabled != enabled:
            await self.repo.update(row, {"enabled": enabled})
        await self.session.commit()
        self._overrides = None


async def get_flag_service(session: AsyncSession = Depends(get_session)) -> FlagService:
    return FlagService(session)


def require_feature(key: str):
    """Route dependency: 404 `feature_disabled` while the flag is off for the caller's tenant."""

    async def dependency(_: Principal = Depends(get_principal), svc: FlagService = Depends(get_flag_service)) -> None:
        if not await svc.is_enabled(key):
            raise NotFound("This feature is not enabled", code="feature_disabled")

    return dependency
