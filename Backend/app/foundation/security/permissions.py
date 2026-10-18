"""Permission registry + role definitions.

Permissions are `resource:action` strings. Grants may use wildcards: `*`, `resource:*`, `*:action`.
Resources registered with `sensitive=True` (user administration, audit, ...) are NOT reachable through action wildcards such
as `*:read`; a role must name them (`user:read`) or hold the global `*`. This keeps "viewer" from reading account data.

Feature teams register their resource once; roles decide who gets what:

    permissions.register("invoice")                 # invoice:create/read/update/delete
    permissions.register("invoice", ["approve"])    # extra action
    permissions.define_role("approver", ["invoice:read", "invoice:approve"])
"""
from __future__ import annotations

import fnmatch

DEFAULT_ACTIONS = ("create", "read", "update", "delete")

_registry: set[str] = set()
_sensitive: set[str] = set()
_roles: dict[str, frozenset[str]] = {
    "admin": frozenset({"*"}),
    "editor": frozenset({"*:create", "*:read", "*:update"}),
    "viewer": frozenset({"*:read"}),
}


def register(resource: str, actions: tuple[str, ...] | list[str] = DEFAULT_ACTIONS, *, sensitive: bool = False) -> None:
    _registry.update(f"{resource}:{a}" for a in actions)
    if sensitive:
        _sensitive.add(resource)


def define_role(name: str, grants: list[str] | tuple[str, ...]) -> None:
    _roles[name] = frozenset(grants)


def known_roles() -> set[str]:
    return set(_roles)


def registered() -> set[str]:
    return set(_registry)


def grants_for(roles: frozenset[str] | set[str]) -> frozenset[str]:
    return frozenset(g for r in roles for g in _roles.get(r, ()))


def allows(grants: frozenset[str], permission: str) -> bool:
    resource = permission.split(":", 1)[0]
    for g in grants:
        if resource in _sensitive and g.startswith("*:"):
            continue  # action wildcards never cover sensitive resources
        if fnmatch.fnmatchcase(permission, g):
            return True
    return False
