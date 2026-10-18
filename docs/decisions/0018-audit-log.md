# ADR 0018: Append-only audit log in the same transaction

* Status: accepted (2026-10-17, fixed)

## Decision
* Every change to a business table writes an `audit_log` row **in the same transaction**, through the repository write
  helpers. The row records the actor, unit, action, table, row id, field diff, request id, IP and time.
* The log is append-only: a trigger refuses UPDATE and DELETE, and the app role has INSERT and SELECT only. Secrets are
  redacted.
* Sensitive reads are audited as events: personal data reveals, exports and payroll lists.

## Consequences
* A change without an audit row is a bug. A test asserts that every Drizzle table is audited, except for an explicit
  allowlist.
* For tamper evidence, audit rows can be shipped nightly to the off-site backup. A hash chain is optional, in Phase 1.
