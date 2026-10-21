# Org units, unit types and the settings hierarchy

**One common pattern for every zone, region and office.** Nothing in the code is specific to Wolaita, Boditi or Damot
Gale. Differences between offices are **data**: the org tree, the unit type of each unit, and settings that are inherited
down the tree. Decision: [ADR-0026](../decisions/0026-unit-types.md).

## 1. Why unit types
The Form 15 staffing tables ([tenant-wolaita.md](../tenant-wolaita.md) §3) show a repeating pattern, not unique offices.
Offices of the same kind have the same teams:

| Observed unit | Teams (work processes) | Collects cash | Terminal |
|---|---|---|---|
| Zone department | all 10 | yes | — |
| Town unit, ፈርጅ 1 (Boditi) | road safety, **competency (licences, inspection)**, freight, public transport | yes (daily revenue collectors) | yes |
| Woreda office, ምድብ 1 (Damot Gale) | road safety, public transport, road quality, design and contract, logistics (machinery), community participation, HR and planning support | to confirm | — |
| Town unit, ፈርጅ 3 / 4 (Gesuba, Bitena) | to confirm (cover pages only) | ? | ? |

Configuring 25+ units one by one would be slow and error-prone. Instead, a **unit type** captures what a kind of office
does, and every unit of that type inherits it.

## 2. Model

```
level_definition (per region)      region > zone > woreda | town  (names in I18nText; depth configurable)
unit_type (per region)             key, name, level, category values allowed (ምድብ 1–n / ፈርጅ 1–4),
                                   default services (service codes + enabled flag),
                                   default teams (org_departments to create),
                                   default role catalogue (roles assignable in this unit),
                                   capabilities (collects_cash, runs_terminal, prints_documents, has_examiners …)
org_unit                           parent, path, unit_type, category, name, code, active
unit_service_override              unit × service → enabled / disabled (+ reason, audited)
```

Effective services of a unit = `unit_type.default_services` ⊕ `unit_service_override`. Each service's configuration
(form, workflow, fee, templates, SLA, approval level) is then resolved down the tree as before
([architecture.md](../architecture.md) §7).

**Capabilities** are named switches that code may check. For example, `collects_cash` shows the cashier screens, and
`runs_terminal` shows terminal operations. Code never checks a unit's name or type key, only capabilities and services.

## 3. Wolaita's starting types (seed data; to be confirmed with the zone)

| Unit type | Level | Default services (codes from [service-catalogue.md](../service-catalogue.md)) | Capabilities | Source |
|---|---|---|---|---|
| `zone_department` | zone | all 54 | collects_cash, prints_documents, has_examiners | [D] Form 15 zone tables |
| `town_unit_f1` | town | RS-01…07, DVC-01…11, FR-01…03, PT-01…06 | collects_cash, runs_terminal, prints_documents, has_examiners | [D] Boditi |
| `woreda_office_m1` | woreda | RS-01…07, PT-04, PT-06 (assist), RQ-01…02, DC-01…07 (local), LG-01…03, CP-01…05, HR-01…06, PB-02 | (collects_cash: to confirm) | [D] Damot Gale |
| `town_unit_f3`, `town_unit_f4` | town | like `town_unit_f1` minus DVC and FR [A] | collects_cash [A] | [A] covers only |
| `city_admin_department` | region-level (to confirm) | like `zone_department` for its own area [A] | as zone | [A] handwritten chart |

A woreda that does issue licences, or a ፈርጅ 3 town without a terminal, is handled with **unit overrides**, not a new type.
New types are added by the bureau admin (data, not code).

## 4. The settings hierarchy (for every configurable value)

```
product default (code)  →  installation  →  each ancestor unit on the tree path (region, zone, sub-city … whatever the levels are)
                        →  unit type  →  unit  →  user preference
```
One resolver serves settings and service configuration ([architecture.md](../architecture.md) §7). It walks the real
ltree ancestors, so regions without zones, special woredas and cities with sub-cities need no special case. Service keys
(`approval_unit`, SLAs, form overlays) live only in service overrides; the settings registry refers to them.

* Every setting is declared once in code with a key, type (Zod), default, and **who may override it at which level**
  (`overridableAt: ['installation', 'ancestor', 'unitType', 'unit']`, `userPreference: boolean`). It also says whether it is sensitive (audited).
* Examples:

| Setting | Declared default | Overridable at | User preference |
|---|---|---|---|
| `i18n.languages` | `[am, en]` | region | — |
| `i18n.language` | region default | — | yes |
| `calendar.display` | `ethiopian` | region | yes (Gregorian toggle) |
| `ui.theme` | `system` | — | yes (light / dark / high contrast) |
| `ui.density` | `comfortable` | region | yes (`compact` for data-entry staff) |
| `branding.logo`, `branding.header` | product | region, zone, unit (document headers) | — |
| `service.<code>.sla.review` | from the service version | per the version's override policy | — |
| `service.<code>.approval_unit` | `handling` | region, zone (allowed key) | — |
| `security.session_idle_minutes` | 30 | installation | — |

* The admin console shows each value with **where it comes from** (default, region, zone, unit) and lets an authorised
  admin override or reset it. Changes are audited.

## 5. Onboarding a new zone (no code, no deployment)
1. The bureau admin adds the zone under the region (or imports the zone and its units from CSV/Excel: name am/en/local
   language, kind, category, parent, code).
2. Each unit gets its **unit type** and category (ምድብ / ፈርጅ). Its services, teams, roles and menus follow.
3. Exceptions become unit overrides (services on or off, approval level, SLA).
4. The zone admin creates users (or imports them). Roles are limited to the unit type's role catalogue.
5. Org units are synced to Keycloak groups automatically.
6. Optional: a zone-specific language (e.g. Wolaytta for Wolaita, Gamo for Gamo) is switched on for that subtree.

A **new region** is a new installation of the same release (ADR-0008), seeded with the same product defaults and its own
level definitions and unit types.

## 6. Implementation notes
* Tables: `unit_types`, `unit_type_services`, `unit_type_roles`, `unit_service_overrides`, `settings_values` (key, scope
  level, scope id, value JSONB, set_by, set_at). They are class C configuration (ADR-0011): readable in the subtree and
  its ancestors.
* An API `GET /me/workspace` returns the active unit's effective services, capabilities, menu and settings in one call
  (cached, invalidated on change). See [navigation-and-menus.md](navigation-and-menus.md).
* Tasks: 0.8 (org tree, unit types, the Wolaita seed), 0.21 (service enablement + settings hierarchy).## 6. Implementation notes
* Code: `@itrms/kernel/org` (`platform/kernel/api/org/`). Tables in the `kernel` schema (migrations 0003 and 0004):
  `org_level_definitions` (key, rank, name), `org_units`, `org_departments`, `unit_types` (level, allowed categories,
  **capabilities** and the **default teams** as columns), `unit_type_services`, `unit_type_roles`,
  `unit_service_overrides` (enabled + reason). `settings_values` comes with task 0.21. All are audited; RLS class C
  arrives with task 0.9.
* **Paths:** one ltree label per unit (`u` + the id's hex), so a rename never touches a path. Triggers set the path
  from the parent, rewrite the whole subtree when `parent_id` changes, and refuse a direct path write, a change of region
  and a move under itself. A GiST index serves subtree queries (`path <@ …`).
* **Levels:** a unit's level must be one of its region's and rank below its parent's level (a special woreda, rank 3,
  can sit directly under the region, rank 1). Categories are short keys: `m<n>` for a woreda category (ምድብ n), `f<n>` for
  a town grade (ፈርጅ n); a unit type lists the ones it allows.
* **Effective services** = the unit type's defaults ⊕ the unit's overrides (`effectiveServices(tx, unitId)`).
* **Admin API** `/api/v1/org-units`: `GET /{id}`, `GET /{id}/subtree`, `POST` (create), `PATCH /{id}` (rename),
  `POST /{id}/moves`, `POST /{id}/deactivations`, `GET|PUT|DELETE /{id}/services/{code}`. Writes send the row version in
  `If-Match`. A unit outside the caller's subtree is 404; moving or deactivating needs a unit strictly below the
  caller's own.
* **Import** (one document shape): YAML (the seeds; top-level `x-` keys hold anchors), CSV (units of an existing region:
  `code, parent, kind, level, type, category, name_am, name_en, name_<tag>…, to_confirm`), Excel (a `units` sheet like the
  CSV, optional `levels` and `unit_types` sheets). Idempotent by code and key, one transaction per file, errors name the
  row (`units.3.parent`). `pnpm --filter @itrms/api seed:org <file> [--region <code>]` runs it as the owner.
* Seeds: `apps/api/seed/org/south-ethiopia.wolaita.yaml`. Test-only fixtures (`apps/api/test/fixtures/org/`): Test Zone B
  and a region without zones (a city with sub-cities and a kebele).
* An API `GET /me/workspace` returns the active unit's effective services, capabilities, menu and settings in one call
  (cached, invalidated on change; task 0.10). See [navigation-and-menus.md](navigation-and-menus.md).
* Tasks: 0.8 (org tree, unit types, the Wolaita seed), 0.21 (service enablement + settings hierarchy).
