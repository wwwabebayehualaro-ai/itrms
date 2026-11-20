# ADR-0065: Configurable role grants: a module adds to another module's role behind its own setting

* Status: accepted (2026-11-20). Task 1.6b2. It refines ADR-0027 (module manifests) and ADR-0031 §2 (roles per unit, never
  token claims); it leaves ADR-0026 (unit types decide which roles an office has) unchanged.

## Context

A role's permissions come from the manifests of the installed modules. A role belongs to the module that names it: the kernel's
`records_officer` (the intake desk) reads the shared registers (people, organisations, vehicles), and the competency module's
roles read the licence register (`licence:read`). The loader refuses a module that grants anything to a role it does not own,
because the role's name must be in the granting module's catalogue.

Task 1.6b showed the cost. The intake desk takes the requests that start from a licence (renewal, replacement, the paper
back-capture), but cannot look a licence up. The "found nothing, capture it from paper" offer therefore reaches nobody at an office
where intake and licensing are different people, which is the reference design's (Boditi: a records officer and a licensing
officer). Bureaus may also differ: one may keep the licence register to the licensing team.

Two simpler options were rejected:
* **The kernel's register permissions name `licence:read`:** the kernel would know a work process (layers point downward only).
* **Role permissions as settings:** permissions are what code checks; a free-form table of grants would let a configuration
  give any role any permission, which no review could follow.

## Decision

1. **A module may declare a role grant** in its manifest: a role another installed module defines, the permissions of its own it
   adds, and a boolean setting of its own that turns the grant on:
   `roleGrants: [{ role: 'records_officer', permissions: ['licence:read'], setting: 'competency.intake_reads_licences' }]`.
2. **The loader checks every grant:** the role is defined by an installed module (and has its name there), each permission is
   defined by the granting module, and the setting is the granting module's own, boolean, sensitive, and never overridable at a
   single unit (an office does not widen its own access). A grant that fails any check stops the start.
3. **The grant is resolved per request** for the active unit: the authenticator adds a grant's permissions when the signed-in
   person holds its role in that unit and its setting resolves true there (installation, region, unit type; ADR-0026's chain).
   Only grants of a held role are resolved. The result is part of the principal, so guards, the menu and the workspace follow it.
4. **Changing a grant's setting needs a fresh second factor** (sensitive, SEC-SE-5) and is audited like every setting.
5. **The first grant:** the competency module's `competency.intake_reads_licences` (default on: the desk looks a licence up before
   it files; a region or a unit type may turn it off) gives `records_officer` `licence:read`. The blood group stays the lead's
   audited reveal (ADR-0052); `licence:read` shows only "on record".

## Consequences

* The permission matrix (roles-and-permissions.md) marks a granted permission with the setting that controls it.
* A grant is read-only by convention: a write permission given this way needs its own ADR.
* One more settings read per request, and only for a person holding a role with a grant.
