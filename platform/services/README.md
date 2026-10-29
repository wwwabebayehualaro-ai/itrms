# @itrms/services

Service catalogue, versions and overrides; starts cases with a frozen configuration

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module (server only) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `services.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |

## What it does (task 0.21b; architecture.md §6.2, §7)

- **Catalogue** (`service_definitions`, class C on the region's root): the 54 services of the reference design, seeded
  from `seed/catalogue.yaml` (`pnpm --filter @itrms/api seed:services <file> --region <code>`), "not configured" until a
  version is published. The kernel's service enablement (`PUT /org-units/{id}/services/{code}`, If-Match) checks a code
  against it through the kernel's `SERVICE_CATALOGUE` port, which this slice provides (its module is global for that).
- **Versions** (`service_versions`, immutable): a seat at the region's root publishes the form and workflow versions,
  the defaults (`sla.<state>`, `approval_unit`, `help.<field>`, `templateHeader`), the override policy (which family a
  `region` or `unit` may change) and the first day it holds. Publishing checks that the form and workflow exist and are
  on, the workflow's effects are registered, and the defaults fit; it reports every override below that no longer fits
  (`conflicts`), and changes nothing below.
- **Overrides** (`service_overrides`, class C on the unit): a unit's values, checked against the current version's policy
  (422 `setting_level_not_allowed`) and facts (`unknown_state`, `unknown_field`). Resolution goes through the kernel's
  one resolver (`@itrms/kernel/settings`): the version's defaults, then the region's root down to the unit.
- **Requests** (`POST /api/v1/service-requests`, `case:create`): a service the unit offers and that is configured starts a
  case on the version in effect today, its resolved configuration frozen on the case (`serviceVersionId`,
  `formVersionId`, `sla`, `help`, `approval_unit`, `sources`). The workflow engine reads a step's SLA from it first.

API: `GET /services`, `GET|POST /services/{code}/versions`, `GET /org-units/{id}/services/{code}/configuration`,
`PUT|DELETE /org-units/{id}/services/{code}/override` (If-Match), `POST /service-requests`. Screens: task 0.21c. Form
overlays (an extra field): 0.21d.
