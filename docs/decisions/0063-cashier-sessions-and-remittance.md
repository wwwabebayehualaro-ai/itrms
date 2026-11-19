# ADR-0063: Cashier sessions, the daily closing and the remittance

* Status: accepted (2026-11-19); the points marked Z are placeholders to confirm with the zone. Tasks 1.12 (sessions and
  closing), 1.12d (remittance) and 1.12e (pad receipts from stock). It refines ADR-0042 §3, §4 and §6.

## Context

ADR-0042 takes a payment at the till and issues its receipt, but nothing ties the money to the person who holds it or to a
day. The zone's cashier closes the day on paper. Then the cashier remits the money to the revenue office under the finance
bureau's account codes, on the bureau's receipt vouchers (form መ/ሂ/7, an Ethiopic series letter and a six-digit serial;
[licence documents](../discovery/2026-11-11-wolaita-licence-documents.md) item 10). The architecture names a daily closing of
expected against counted cash, and a remittance report (§9).

## Decision

1. **A cashier session** belongs to one cashier, one office and one business day (Africa/Addis_Ababa). A cashier opens it
   explicitly with an opening float, or the first payment of the day opens it with a float of zero (Z). Every new payment
   names an open session of its own cashier, office and day. A composite key and an insert trigger in the database guarantee
   it. A payment never joins an earlier day's session. A session of an earlier day still open is shown as overdue and blocks
   nothing (Z). Payments made before this decision have no session and are left out of closings and remittances.
2. **The closing.** The cashier counts the till: a total, optionally broken down by denomination (the region's list, Z). The
   server checks the breakdown against the total. The first count freezes what the session expects: the float plus its cash
   receipts not voided. Bank slips are listed but are not cash in the till. Then:
   * a count equal to what is expected closes the session;
   * a difference needs a note, and the session waits for a decision by another person in a role the region names
     (`fees.sessions.approverRoles`, the finance officer by default), at the office or above it, and never the cashier;
   * approved, the session closes; rejected (with a note), the cashier counts again.

   A closed session is never changed. The database enforces this, together with the allowed moves and the separation of
   duties.
3. **One lock order** extends ADR-0042 §4: case → order → cashier session → counter → payment → stationery item → receipt →
   reversal.
   * A payment and a reversal decision hold the session in share mode.
   * A count, a count decision and a remittance hold it exclusively. A remittance takes its sessions in id order.
4. **A reversal after the till closed** (ADR-0042 §6, unchanged otherwise) does not touch the closed session. It is marked as
   such, and becomes a negative line on the office's next remittance under the receipt's accounts. The counted cash is
   deposited, and Finance makes the refund (Z).
5. **The remittance** (1.12d) is the office's, for all its cashiers (Z). It covers every closed session not yet remitted up to
   a day, and takes a number from the office's counter.
   * Its lines group the receipts by the finance bureau's account code and budget category. The codes come from a region
     setting keyed by the fee line; the demo codes are placeholders (Z). The lines are frozen copies.
   * A deferred database check keeps its total equal to the receipts of its sessions less the reversals after the till
     closed. A receipt and a session are remitted at most once.
   * The deposit slip is recorded once, against the amount due.
   * Its document (am/en, QR) is issued through the documents slice from an outbox event, as the receipt's is.
6. **Pad receipts** (1.12e) take the series and serial of a receipt leaf the office holds in its stationery stock (ADR-0050,
   task 1.12a), in the payment's transaction. A leaf not held, already used or spoiled is refused. The serial is unique within
   its series letter until the zone answers whether it starts again with each printing (R11, Z).

## Consequences

* The demo, the existing journeys and a till shared by parallel test runs keep working: the first payment opens the session.
* A cashier who never counts leaves an overdue session that cannot be remitted until it is counted. Forcing a count is a
  follow-up.
* Reversal approvals stay as ADR-0042 §6 made them; only the "after the till closed" mark is new.
