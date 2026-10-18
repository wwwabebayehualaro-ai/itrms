"""The foundation's own module: platform endpoints and screens every application built on the foundation gets.

Always on (kind `platform`). Further platform capabilities (approvals, numbering) add their routers and menu entries here.
"""
from app.foundation.approval.router import router as approval_router
from app.foundation.numbering.router import router as sequence_router
from app.foundation.registry.router import router as registry_router
from app.foundation.registry.spec import ModuleSpec, NavGroup, NavItem, RouterMount

ADMIN_GROUP = "Administration"

PLATFORM = ModuleSpec(
    key="platform",
    title="Platform",
    kind="platform",
    description="Modules and feature flags, approvals, document numbers",
    routers=(RouterMount(registry_router), RouterMount(approval_router), RouterMount(sequence_router)),
    nav=(
        NavGroup("Work", order=10, items=(
            NavItem("Approvals", route="/approvals", icon="square-check"),
        )),
        NavGroup(ADMIN_GROUP, order=900, items=(
            NavItem("Feature flags", route="/admin/feature-flags", icon="flag", permission="feature_flag:read"),
            NavItem("Document numbers", route="/admin/sequences", icon="hash", permission="sequence:read"),
        )),
    ),
)
