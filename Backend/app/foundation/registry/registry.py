"""The installed modules of the application (process-wide, filled once at startup)."""
from __future__ import annotations

from collections.abc import Callable, Iterable

from fastapi import Depends, FastAPI

from app.foundation.registry import flags
from app.foundation.registry.spec import ModuleSpec, NavItem

_modules: dict[str, ModuleSpec] = {}


def register_module(spec: ModuleSpec) -> ModuleSpec:
    if spec.key in _modules and _modules[spec.key] is not spec:
        raise ValueError(f"module {spec.key!r} registered twice")
    _modules[spec.key] = spec
    flags.register(spec.flag_key, default=spec.default_enabled or not spec.can_disable, description=spec.description or spec.title,
                   kind="module", locked=not spec.can_disable)
    for key, default, description in spec.flags:
        flags.register(key, default=default, description=description)
    return spec


def register_modules(specs: Iterable[ModuleSpec]) -> None:
    for spec in specs:
        register_module(spec)
    for spec in _modules.values():
        missing = [d for d in spec.depends_on if d not in _modules]
        if missing:
            raise ValueError(f"module {spec.key!r} depends on modules that are not installed: {missing}")


def modules() -> list[ModuleSpec]:
    return list(_modules.values())


def get(key: str) -> ModuleSpec | None:
    return _modules.get(key)


def mount(app: FastAPI) -> None:
    """Include every module's routers. Switchable modules answer 404 `feature_disabled` while their flag is off."""
    from app.foundation.registry.service import require_feature

    for spec in _modules.values():
        deps = [Depends(require_feature(spec.flag_key))] if spec.can_disable else []
        for mount_ in spec.routers:
            app.include_router(mount_.router, prefix=mount_.prefix, dependencies=deps)


def navigation(enabled: set[str], can: Callable[[str], bool]) -> list[dict]:
    """Menu groups of the enabled modules, filtered by permission, groups with the same title merged (lowest order first)."""
    groups: dict[str, tuple[int, list[dict]]] = {}

    def item(n: NavItem) -> dict | None:
        if n.permission and not can(n.permission):
            return None
        children = [c for c in (item(ch) for ch in n.children) if c]
        if n.children and not children and not n.route and not n.slot:
            return None
        return {"label": n.label, "route": n.route, "icon": n.icon, "slot": n.slot, "children": children}

    for spec in _modules.values():
        if spec.key not in enabled:
            continue
        for group in spec.nav:
            items = [i for i in (item(n) for n in group.items) if i]
            if not items:
                continue
            order, existing = groups.get(group.title, (group.order, []))
            groups[group.title] = (min(order, group.order), existing + items)
    return [{"title": title, "items": items} for title, (_, items) in sorted(groups.items(), key=lambda kv: kv[1][0])]
