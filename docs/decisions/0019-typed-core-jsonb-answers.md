# ADR 0019: Typed core tables; form answers in JSONB

* Status: accepted (2026-10-17, fixed)

## Decision
* **Typed tables** with constraints hold the core records: people and organisations, vehicles, plates, licences,
  associations, routes, road projects, contracts, payments and documents.
* Form answers are **JSONB** in `submissions`. Each submission is linked to its case, the **form version** and the typed
  records it refers to; lookup fields store ids.
* Workflow effects copy the facts that matter from the answers into the typed tables, in the same transaction. Reports and
  lookups read the typed tables, never the JSONB.

## Consequences
* A new service needs no schema change, unless it creates a new kind of registry fact.
* The data viewer still queries JSONB answers, through the allow-listed compiler, for service-specific reports.
