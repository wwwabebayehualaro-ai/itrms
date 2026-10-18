# ADR 0017: Every service is configuration, inherited down the tree

* Status: accepted (2026-10-17, fixed)

## Decision
* A service (54 at the start) is a **form definition + workflow + fee rule + document templates**. The bureau publishes them
  together as one versioned `service_version`.
* Lower units may override **only the keys the version allows** (`overridePolicy`). Resolution walks from the root down to
  the unit, and the nearest override wins per key. Form changes are overlays, never forks.
* A case freezes its resolved configuration when it is created, so configuration changes never alter open cases.
* Behaviour that touches registries or money is **module code** ("effects"). The configuration names the effects, and
  publishing checks that each named effect exists. Configuration never contains code.

## Consequences
* The service catalogue replaces the legacy `features/*.yaml` registry.
* Publishing validates the parts together: the form, the workflow's step forms, the fee rule's inputs and the template data.
