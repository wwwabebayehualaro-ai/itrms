/**
 * What the register and the other licence services read of a licence's restrictions (DVC-21, task 1.6c): plain queries, so the licence
 * services can ask without depending on the service that records them. The register is class R: the region reads every restriction.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';

import { restrictionHolds, type LicenceRestriction } from '../contracts';
import { licenceRestrictions } from './competency.table';

type Row = typeof licenceRestrictions.$inferSelect;

const out = (r: Row): LicenceRestriction => ({
    id: r.id,
    kind: r.kind,
    authority: r.authority,
    authorityReference: r.authorityReference,
    decidedOn: r.decidedOn,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    caseId: r.caseId
});

/**
 * Each licence's restriction to show on a day: the one that holds (a cancellation before a suspension), else the next one still to
 * come. A suspension that has run out is history and is not shown.
 */
export async function restrictionsShown(
    tx: Tx,
    licenceIds: readonly string[],
    today: string
): Promise<Map<string, LicenceRestriction>> {
    const shown = new Map<string, LicenceRestriction>();
    if (licenceIds.length === 0) return shown;
    const rows = await tx
        .select()
        .from(licenceRestrictions)
        .where(
            and(
                inArray(licenceRestrictions.licenceId, [...licenceIds]),
                or(isNull(licenceRestrictions.endsOn), gte(licenceRestrictions.endsOn, today))
            )
        )
        .orderBy(desc(licenceRestrictions.startsOn));
    const rank = (r: Row) => (restrictionHolds(out(r), today) ? (r.kind === 'cancellation' ? 0 : 1) : 2);
    // what holds first (a cancellation before a suspension), then the one that starts soonest
    for (const r of [...rows].sort((a, b) => rank(a) - rank(b) || a.startsOn.localeCompare(b.startsOn)))
        if (!shown.has(r.licenceId)) shown.set(r.licenceId, out(r));
    return shown;
}

/** Whether a restriction holds on the licence on a day: the other licence services refuse it then. */
export async function restrictedOn(tx: Tx, licenceId: string, today: string): Promise<boolean> {
    const [held] = await tx
        .select({ id: licenceRestrictions.id })
        .from(licenceRestrictions)
        .where(
            and(
                eq(licenceRestrictions.licenceId, licenceId),
                lte(licenceRestrictions.startsOn, today),
                or(isNull(licenceRestrictions.endsOn), gte(licenceRestrictions.endsOn, today))
            )
        )
        .limit(1);
    return held !== undefined;
}
