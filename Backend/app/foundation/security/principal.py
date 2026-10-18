from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.foundation.security import permissions


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    tenant_id: UUID
    email: str
    roles: frozenset[str]

    @property
    def grants(self) -> frozenset[str]:
        return permissions.grants_for(self.roles)

    def can(self, permission: str) -> bool:
        return permissions.allows(self.grants, permission)
