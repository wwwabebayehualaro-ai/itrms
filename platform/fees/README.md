# @itrms/fees

Fee rules, payment orders, payments, receipts and the cashier

**Controlled stationery (task 1.12a, ADR-0050).** Pre-printed, serial-numbered forms an office accounts for one by one:
libre booklets, licence card blanks, bolo stickers (per category and fiscal year) and receipt leaves.
- **Where they come from:** a unit with the `holds_stationery` capability receives a delivery (from the regional bureau,
  which sells them with a unit price, or the ministry).
- **How they move:** it hands runs to a unit directly below it, which accepts them; it recalls them and writes them off.
  `StationeryStock.use` gives one item of the acting office's stock to one record, once, idempotent per record; slices call
  it in their own transaction. `spoil` keeps a misprint on record.
- **The office's daily count** (`close`) flags what it should hold and did not count, and what it counted and should not
  hold.
- **What enforces it:** a trigger checks the item's machine, and the counts reconcile with the ledger (`summary`).
- **Its first consumer:** a licence print batch back from the printer takes one card blank per licence.

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module (server only) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `fees.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
