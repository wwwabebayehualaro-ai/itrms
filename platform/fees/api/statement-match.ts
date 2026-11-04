/**
 * Whether a statement's line verifies a reference (task 0.22c, ADR-0043). Money moves on an exact match only: the issuer,
 * the reference and the fiscal year found the two, and here the amount and the date must be the same too. Anything else
 * goes to a person with the reason, and is never settled by a guess. A statement never verifies what its own importer
 * entered: one person could then make a payment out of nothing (separation of duties).
 */
export type LineVerdict =
    | { state: 'matched' }
    | { state: 'amount_mismatch' }
    | { state: 'held'; reason: 'date_differs' | 'paid_before_order' | 'importer_entered' };

export interface MatchFacts {
    line: { amountSantim: bigint; paidOn: string };
    ref: { amountSantim: bigint; paidOn: string; enteredBy: string };
    /** the day the order was issued (Addis Ababa) */
    orderDay: string;
    importedBy: string;
}

export function judgeLine({ line, ref, orderDay, importedBy }: MatchFacts): LineVerdict {
    if (line.amountSantim !== ref.amountSantim) return { state: 'amount_mismatch' };
    if (line.paidOn !== ref.paidOn) return { state: 'held', reason: 'date_differs' };
    // a receipt older than the order may be an old receipt used again: a person looks at it
    if (ref.paidOn < orderDay) return { state: 'held', reason: 'paid_before_order' };
    if (ref.enteredBy === importedBy) return { state: 'held', reason: 'importer_entered' };
    return { state: 'matched' };
}
