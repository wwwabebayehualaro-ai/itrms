# ADR 0014: Money as integer santim; numbers from transactional counters

* Status: accepted (2026-10-17, fixed)

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 7.

## Decision
* **Money** is stored as `bigint` santim (1 Birr = 100 santim), or as `numeric(18,4)` for quantities and unit rates.
  * In code it is the `Money` type from `packages/schemas`, and a lint rule forbids JS `number` arithmetic on money.
  * Rounding is explicit (half-up to the santim) and happens once per line.
* **Document numbers** come from a counter row updated inside the business transaction (`UPDATE number_counters …
  RETURNING`). This covers the documents ITRMS itself legally issues: receipts, its own certificates, correspondence and
  payroll-list numbers. Plate numbers are federal serials, licence numbers become the national reference once available,
  and case numbers use a plain sequence (ADR-0031).
  * Native `CREATE SEQUENCE` objects are not used for document numbers. They are non-transactional and leave gaps on
    rollback, which auditors reject for receipts.
  * The rule's intent, "DB sequences inside transactions", still holds: the database generates each number in the same
    transaction as the business change.
* Number patterns are set per region and key, e.g. `{unit}/{seq:06}/{efy}`, with a yearly reset on the Ethiopian fiscal
  year.

## Consequences
* Counters serialise concurrent issuers per key and unit, which is fine at office scale.
* A voided receipt keeps its number and gets a reversal record. Numbers are never reused.
