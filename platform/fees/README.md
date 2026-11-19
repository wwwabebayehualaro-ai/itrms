# @itrms/fees

Fee rules, payment orders, payments, receipts and the cashier

**Controlled stationery (task 1.12a, ADR-0050).** Pre-printed, serial-numbered forms an office accounts for one by one:
libre booklets, licence card blanks, bolo stickers (per category and fiscal year) and receipt leaves.
- **Where they come from:** a unit with the `holds_stationery` capability receives a delivery (from the regional bureau,
  which sells them with a unit price, the ministry, or for receipt vouchers the regional finance bureau).
- **How they are numbered:** a series of up to six letters, Latin or Ethiopic (receipt vouchers come in series such as
  `ለ`), and a serial of up to eight digits, printed at the width the form carries.
- **How they move:** it hands runs to a unit directly below it, which accepts them; it recalls them and writes them off.
  `StationeryStock.use` gives one item of the acting office's stock to one record, once, idempotent per record; slices call
  it in their own transaction. `spoil` keeps a misprint on record.
- **The office's daily count** (`close`) flags what it should hold and did not count, and what it counted and should not
  hold.
- **What enforces it:** a trigger checks the item's machine, and the counts reconcile with the ledger (`summary`).
- **Its first consumer:** a licence print batch back from the printer takes one card blank per licence.

**Cashier sessions and the daily closing (task 1.12, ADR-0063).** One cashier at one office on one business day: the first
payment opens the session (or the cashier opens it with a float); the cashier counts the till; a difference needs a note and
another person's decision (`fees.sessions.approverRoles`); a closed session never changes. A payment holds its session in
share mode, a count exclusively (`CashierSessionsService`). A reversal decided after the till was counted is marked
`after_till_closed`.

**Pad receipts from stock (task 1.12e, ADR-0063 §6).** At an office whose setting `fees.receipts.source` is `pad`, a payment
names a leaf (`pad: { series, serial }`: letters, Latin or Ethiopic, up to six; one to eight digits). The office must hold
stationery (else 409 `not_configured`, `fees.errors.pad_needs_stock`). After the payment row, in the same transaction and in
the lock order payment, stationery item, receipt, `StationeryStock.use` takes the `receipt_leaf` the office holds and
names `fees.payments` and the payment id as what used it. A leaf the office does not hold, one already used or spoiled, is
409 and the payment rolls back with it. The receipt keeps the item's series and its serial at the item's width
(`ለ/000123`), so `123` and `000123` are one leaf; a serial is unique within its series letter (rule R11). A cashier does not write
off stock: a spoiled or torn leaf goes to the stationery keeper, who records it with the 1.12a write-off
(`POST /api/v1/stationery/write-offs`, `stationery:write-off`, a reason, audited; the leaf is then `void`). The form is
offered a leaf once, when it loads, by `GET /api/v1/receipt-leaves/next` (`payment:record`, the office's own stock): the
leaf after the cashier's last one when held and free, else the lowest free one. Pad serials are stored canonical (padded
to the stock's width) from 1.12e: an installation with older, unpadded pad receipts must backfill them before rollout
(none is deployed). The remittance and the closing treat a pad receipt like any other;
the stationery summary counts the leaf as used or spoiled.

**The remittance (task 1.12d, ADR-0063 §5).** The office's deposit of its closed sessions up to a day (`RemittancesService`,
`remittance-build.ts` for the arithmetic): lines by finance account from the region setting `fees.accounts`, the reversals
after the till closed as negative lines under the receipt's frozen account, the deposit due (counted cash less the floats),
a number from the counter `fees.remittance`, and the bank deposit slip recorded once. Permission `remittance:
read | prepare | deposit`; event `remittance.prepared.v1` (the documents slice issues the `remittance` document).

Layer: platform. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module (server only) |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `fees.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |
