# ADR 0026: Unit types and a settings hierarchy; one pattern for every office

* Status: accepted (2026-10-18)

## Context
The Form 15 staffing tables show that offices of the same kind have the same teams. A ፈርጅ-1 town (Boditi) has a
competency team, terminal and cash collectors. A ምድብ-1 woreda (Damot Gale) has road works and community teams but no
licensing. ITRMS will be sold to many zones and regions. Coding or hand-configuring each office would not scale.

## Decision
* Every org unit has a **unit type** (per region, data): default services, teams, role catalogue and **capabilities**
  (`collects_cash`, `runs_terminal`, `prints_documents`, `has_examiners`, …). Unit-level overrides handle exceptions.
* Every configurable value is declared once in code (key, Zod type, default, the levels where it may be overridden, whether
  it is a user preference). It is resolved product → installation → region → zone → unit type → unit → user.
* Code checks **services and capabilities**, never unit names or type keys.
* Onboarding a zone or region is data entry or import, never code.

Details: `docs/platform/org-and-unit-types.md`.

## Consequences
* Tasks 0.8 and 0.21 include unit types, capabilities, unit overrides and the settings registry. Wolaita's types are the
  first seed.
* The admin console must show where each effective value comes from.
