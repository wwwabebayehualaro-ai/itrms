# Platform design

How ITRMS is built as one product for many bureaus, zones and woredas: the common pattern, the modules, the shell, the
design system and the enterprise capabilities. Read after [../architecture.md](../architecture.md).

| Document | Answers | Decision |
|---|---|---|
| [org-and-unit-types.md](org-and-unit-types.md) | How every office is configured from one pattern (unit types, the settings hierarchy, onboarding a new zone) | [ADR-0026](../decisions/0026-unit-types.md) |
| [code-structure.md](code-structure.md) | The inside of every app, slice and package (frontend, backend, shared), dependency rules, file naming, where new code goes | [ADR-0032](../decisions/0032-workspace-structure.md) |
| [modularization.md](modularization.md) | How the code is cut (kernel, platform services, registries, work-process modules), module manifests, entitlements | [ADR-0027](../decisions/0027-vertical-slice-modules-and-entitlements.md) |
| [navigation-and-menus.md](navigation-and-menus.md) | The application shell, menus, command palette, role workspaces, deep links | [ADR-0028](../decisions/0028-menu-and-workspace-model.md) |
| [design-system.md](design-system.md) | Tokens, themes, branding, Ethiopic typography, status vocabulary, page templates, components, accessibility | [ADR-0029](../decisions/0029-design-tokens-and-theming.md) |
| [form-platform.md](form-platform.md) | What the form builder guarantees (10 tested guarantees), form ↔ effect contracts, governance and lifecycle, field catalogue incl. Ethiopian types, authoring UX | [ADR-0030](../decisions/0030-hybrid-delivery-builder-and-code.md) |
| [delivery-decisions.md](delivery-decisions.md) | Builder or code for **each of the 54 services**, with the deciding criterion and what is configured vs. coded | [ADR-0030](../decisions/0030-hybrid-delivery-builder-and-code.md) |
| [enterprise-capabilities.md](enterprise-capabilities.md) | Administration, work management, reports, records, data management, communication, security, help, API, operations: what comes in which phase | — |
