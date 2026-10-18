"""Module registry and feature flags.

An application is the foundation plus a list of modules. Each module describes itself once with a `ModuleSpec` (routers,
navigation, whether a tenant may switch it off); the registry mounts the routers, guards them with the module's flag and
serves the navigation the frontend builds its menu from. Feature flags switch modules and single features per tenant.
"""
from app.foundation.registry.spec import ModuleSpec, NavItem, RouterMount  # noqa: F401
