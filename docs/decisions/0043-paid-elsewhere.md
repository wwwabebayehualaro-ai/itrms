# ADR 0043: Money paid elsewhere

* Status: accepted (2026-11-04, task 0.22c). It builds on ADR-0042 (payments and receipts) and ADR-0031 §5 (the money path).
  The product owner asked for the open questions to be decided by the state of the art and the Ethiopian context; the
  ones that rest on an assumption are marked and should be confirmed with a bureau.

## Context
* An office with no till, or a service the bureau wants collected elsewhere, has its fee paid at a revenue office or a bank
  (`payment.collection = elsewhere`, ADR-0042). The applicant comes back with a receipt or a deposit slip.
* The threat (threat model 3): a fake "paid at the revenue office" reference, or one real receipt used for two cases.
* No public layout was found for an Ethiopian bank's or revenue office's statement, nor a fixed format for its references.
  The Ministry of Finance is moving revenue receipts to QR codes, so what a reference looks like may change.

## Decision
1. **A reference settles an order; it is not a payment at our till.** `payments` and `receipts` stay money ITRMS took, so a
   cashier's closing (Phase 1) never counts another institution's money. The issuer's receipt is the receipt: ITRMS issues
   no number for it. `payment_orders.settled_external_ref_id` settles the order, and exactly one of the two settles it.
2. **Who issues** is a region setting (`fees.external.issuers`: a code, a kind, a name). *Assumption:* a revenue office and
   the Commercial Bank of Ethiopia by default. No reference format is assumed: any letters and digits, up to 40.
3. **One real reference settles one case.** The key is the issuer, the reference and the fiscal year of the day it was paid,
   unique in the region while the reference is pending or verified (the database's own index, whichever office asks). The
   reference is compared by its letters and digits in capitals, without leading zeros, because punctuation must not make
   another reference and a spreadsheet drops a serial's zeros. Numbers may restart each year, hence the year in the key.
   A deposit can't be used both ways: a slip taken at a till and a reference elsewhere each ask a narrow `SECURITY DEFINER`
   function that answers only yes or no for the caller's region (past RLS, ADR-0032) and holds a lock on the reference
   until the transaction ends.
4. **Entered at the counter, it settles nothing.** It is the whole total (no part payments), at the case's office, one at a
   time per order. `external-payment:enter`: the records officer and the cashier.
5. **Verified by a second person**: a role the region's `fees.external.verifierRoles` names (the finance officer by default),
   at the office or above it; never who entered it (refused on record; the database checks it too). A rejection says why
   and frees the key, so a mistyped number can be corrected. The verifier sees what ITRMS knows: earlier rejections of the
   same reference, a date before the order, and what a statement says.
6. **Or by a statement's line, on an exact match only.** The issuer, reference, fiscal year, amount and date must all agree,
   in the importing office's subtree. There is no fuzzy matching: anything else keeps the reference pending and marks the
   line with the reason (`amount_mismatch`, `held`). A line never verifies what its importer entered, because one person
   could then make a payment out of nothing. A date before the order is held too: perhaps an old receipt used again.
   A case that can't move on (nobody holds its next step) holds its line, and the file goes on.
7. **Statements are evidence.** A file is taken once per issuer (by its hash), kept as it was out of the audit log, and never
   changes; its lines keep only what matching needs, never the payer. The same money on a second line is a duplicate, on
   record, and verifies nothing. A request checks the header; the worker reads the lines and matches them (nothing heavy in a
   request), each line in its own transaction, so a retry carries on where it was. A reference entered after its statement
   is matched too, on `external-payment.entered.v1`.
8. **The layout is a named placeholder** (`placeholder-v1`: columns `reference`, `amount`, `date` in ISO form, by header).
   Amounts are read by digits, never through a number. A real layout, or ISO 20022 camt.053 when a bank offers it, is another
   entry of `LAYOUTS` in `statement-layouts.ts`. The file is at most 512 KB and 5,000 lines: one office's day.
9. **A verified reference that proves wrong is revoked**, with a reason, by a third person in the verifier's role: never who
   entered or verified it. The order is open again and the case unsettled; the key is free. A closed case's is refused, as a
   reversal is (ADR-0042). An order cancelled (a changed fee, a closed case) withdraws its pending reference.
10. **One lock order**: the case, the order, the reference, then a statement's line.

## Consequences
* A statement's importer is trusted: a fake file verifies what it names. Separation of duties (6), the audit trail, the
  kept file and the permission (`external-statement:import`, finance officers) limit this. Comparing with a provider's API
  (Phase 3) removes it.
* An unmatched reference and an unmatched line both stay visible. Phase 1's closing (1.12) reports them.
* The verifier checks a reference by the paper in front of them. A scan of the receipt, and QR verification of the Ministry's
  receipts once their format is known, are follow-ups.
* A reversal does not take a case back, and neither does a revocation: the workflow's guard on `payment.settled` holds it
  (ADR-0042).
