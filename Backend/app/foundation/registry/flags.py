"""Feature-flag definitions (code) and their per-tenant values (database).

Flags are declared in code with a default (`register`); a tenant row overrides the default. Unknown keys are rejected, so a
typo cannot silently read as "off".
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FlagDefinition:
    key: str
    default: bool
    description: str
    kind: str = "feature"  # feature | module
    locked: bool = False  # platform modules: always on


_definitions: dict[str, FlagDefinition] = {}


def register(key: str, *, default: bool = False, description: str = "", kind: str = "feature", locked: bool = False) -> FlagDefinition:
    existing = _definitions.get(key)
    definition = FlagDefinition(key, default, description, kind, locked)
    if existing and existing != definition:
        raise ValueError(f"feature flag {key!r} registered twice with different settings")
    _definitions[key] = definition
    return definition


def definition(key: str) -> FlagDefinition | None:
    return _definitions.get(key)


def definitions() -> list[FlagDefinition]:
    return sorted(_definitions.values(), key=lambda d: (d.kind != "module", d.key))
