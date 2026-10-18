from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from fastapi import APIRouter

ModuleKind = Literal["platform", "coded", "form"]


@dataclass(frozen=True)
class NavItem:
    """One menu entry. `icon` is a lucide icon name (kebab-case, e.g. "file-text"; https://lucide.dev/icons). `permission`
    hides it from users who lack it; `slot` marks a place the frontend fills itself (e.g. the dynamic list of forms);
    `children` nest one level."""

    label: str
    route: str | None = None
    icon: str | None = None
    permission: str | None = None
    slot: str | None = None
    children: tuple[NavItem, ...] = ()


@dataclass(frozen=True)
class NavGroup:
    """A titled section of the menu. Modules contributing to the same group title are merged (lower `order` first)."""

    title: str
    items: tuple[NavItem, ...]
    order: int = 100


@dataclass(frozen=True)
class RouterMount:
    router: APIRouter
    prefix: str = ""


@dataclass(frozen=True)
class ModuleSpec:
    """What the registry needs to know about a module.

    kind: `platform` (always on, part of the foundation), `coded` (a feature written as code) or `form` (a module serving
    builder-made forms). Non-platform modules can be switched off per tenant with the flag `module.<key>`.
    """

    key: str
    title: str
    kind: ModuleKind
    description: str = ""
    routers: tuple[RouterMount, ...] = ()
    nav: tuple[NavGroup, ...] = ()
    default_enabled: bool = True
    depends_on: tuple[str, ...] = ()
    flags: tuple[tuple[str, bool, str], ...] = field(default=())
    """Feature flags this module owns: (key, default, description)."""

    @property
    def flag_key(self) -> str:
        return f"module.{self.key}"

    @property
    def can_disable(self) -> bool:
        return self.kind != "platform"
