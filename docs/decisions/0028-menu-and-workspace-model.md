# ADR 0028: Menus declared by modules, computed per user and unit, customisable by the bureau

* Status: accepted (2026-10-18)

## Context
The legacy menu comes from the backend registry, filtered by permission and module flag. It is English-only, unaware of
org units, and not customisable. ERP users need search-first navigation, role home pages and work counts.

## Decision
* Menu items, quick actions, badges and dashboard widgets are **declared in module manifests**, with i18n label keys and
  requirements (permission, services, capabilities).
* The server computes the **effective menu** for the user and active unit (`GET /me/workspace`): availability filter, then
  the permission and capability filter, then the **bureau overlay** (rename, reorder, hide, links, default home per role),
  then the user's favourites. An overlay can never widen access.
* The shell has:
  * the sidebar grouped by work process;
  * a unit switcher;
  * a **command palette** (Ctrl+K: navigation, actions, record search);
  * a notifications bell, favourites and recents, badges;
  * role workspaces built from widgets.
* The locale and the unit are not in URLs. List state is in URLs. Icons are collected from the manifests at build time.

Details: `docs/platform/navigation-and-menus.md`.

## Consequences
* Task 0.10 builds the shell and the workspace endpoint. Task 0.13 adds the translated menu. The overlay admin screen comes
  in Phase 1 (Phase 0 uses manifest defaults).
