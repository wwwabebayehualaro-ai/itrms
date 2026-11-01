# ADR 0042: Payments and receipts

* Status: accepted (2026-11-01, task 0.22b). It refines ADR-0014 (money and numbering) and ADR-0041 (fee rules), and
  replaces, for payments, the asynchronous event of modularization.md §5 with an in-transaction port.

## Context
* A case's fee (ADR-0041) must be paid before its workflow goes on (`payment.settled`), and a payment must give a receipt
  whose number is gapless per office and fiscal year (ADR-0014), also when cashiers record payments at the same moment.
* The fees slice sits below the workflow in the layer order: it may not import it, yet a payment changes the case.
* The product owner decided (2026-11-01): receipt numbers come from ITRMS by default, or from a controlled pre-printed
  pad at an office that keeps one; who collects is set per service (the office cashier by default, or elsewhere).

## Decision
1. **A payment order is the case's newest fee**, its lines copied: one live order per case. The effect
   `fees.createPaymentOrder` makes it (run twice, it names the order it made); a reassessed fee (`fees.assess`) cancels an
   open order and issues the next; a paid order refuses a changed fee (409 `fee_already_paid`): its receipt is reversed
   first.
2. **A payment is the whole total**, at the till of the case's handling office (its type has `collects_cash`), by cash or a
   bank deposit slip; the cashier confirms the amount (409 `amount_mismatch` otherwise). No part payments in Phase 0. A bank
   slip pays one order in the region (its reference normalised), until a reversal voids it.
3. **The receipt is issued in the payment's transaction**: ITRMS's number from the office's counter `fees.receipt`
   (`{unit}/{seq:06}/{efy}`, set up by the seed for every office that collects cash), so a rollback gives the number back;
   or, where the office's setting `fees.receipts.source` is `pad`, the pad's series and serial (unique per office for ever;
   the issued ranges are checked with controlled stationery, Phase 1 task 1.12a).
4. **One lock order**: the case, then the order, then the counter (then the payment and the reversal), for every write a
   payment makes, so a payment and a transition never deadlock.
5. **The case port** (`FEE_CASE_PORT`, provided by the workflow and bound by the services slice): in the payment's own
   transaction the workflow locks the case, replaces its fact `payment` (`{ orderId, settled, totalSantim, collection }`),
   puts the change on its timeline (kind `payment`), and moves a case waiting on `event:payment.settled` on (actor
   `system:fees`). A workflow may instead guard a person's action on `payment.settled`. Events (`payment.settled.v1`,
   `receipt.issued.v1`, `receipt.reversed.v1`) go to the outbox for later consumers (0.23's receipt document).
6. **A reversal** is asked for by a cashier of the office with a reason, and decided once by another person in a role the
   region's `fees.reversals.approverRoles` names (the finance officer by default), at the office or one above it; never the
   person who asked nor the cashier who took the money (the database checks it too). Approved, the payment is voided, the
   order open again, the case's payment unsettled; the receipt keeps its number and shows as reversed. A reversal has no
   number of its own in Phase 0.
7. A closed case's open order is cancelled (the worker, on `case.transitioned.v1`).

## Consequences
* A paid case moves on in the same transaction as its payment: never a paid case left waiting.
* 0.22c's verified external references and Phase 3's provider webhooks settle an order through the same port.
* A new office that collects cash needs `seed counters` run again before its first receipt (409 `not_configured` until).
