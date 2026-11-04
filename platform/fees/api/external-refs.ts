/**
 * References of money paid elsewhere, what both the orders and the worker need of them (task 0.22c, ADR-0043): how a
 * reference is compared, how a cancelled order lets go of its pending one, and how one reads.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { efy, fiscalYearRange, isoDate, toGregorian } from '@itrms/ethiopian-calendar';
import { updateAudited, type Tx } from '@itrms/kernel/db';
import { unitRefs } from '@itrms/kernel/org';
import { santimText, type I18nText } from '@itrms/schemas';

import type { ExternalRefOut } from '../contracts';
import { externalPaymentRefs, externalStatementLines, paymentOrders } from './fees.table';

type RefRow = typeof externalPaymentRefs.$inferSelect;

/**
 * A slip reference as compared: upper case, its letters and digits only ("ft 12-345" and "FT/12.345" are "FT12345"), so
 * punctuation can't make one slip pay two orders.
 */
export const normalisedReference = (reference: string): string =>
    reference.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * A reference paid elsewhere as compared: as a slip, and without leading zeros: a receipt's serial is the same leaf
 * however it is written, and a spreadsheet drops them on the way to a statement. Empty when nothing is left of it.
 */
export const externalReferenceKey = (reference: string): string => {
    const key = normalisedReference(reference).replace(/^0+/, '');
    return key === '' && normalisedReference(reference) !== '' ? '0' : key;
};

/** The fiscal year of a day paid (Addis Ababa's noon: the day is a calendar day, never moved by a clock). */
export const fiscalYearOfDay = (day: string): number => efy(new Date(`${day}T12:00:00+03:00`));

/** A fiscal year's first and last day, as calendar days. */
export function fiscalYearDays(year: number): { first: string; last: string } {
    const { start, end } = fiscalYearRange(year);
    return { first: isoDate(toGregorian(start)), last: isoDate(toGregorian(end)) };
}

/** The day an order was issued, in Addis Ababa. */
export const addisDayOf = (instant: Date): string =>
    new Date(instant.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** An order cancelled lets go of its pending reference: its key is free again, and nothing waits on it. */
export async function withdrawPending(tx: Tx, orderId: string): Promise<void> {
    const [pending] = await tx
        .select()
        .from(externalPaymentRefs)
        .where(and(eq(externalPaymentRefs.orderId, orderId), eq(externalPaymentRefs.state, 'pending_verification')))
        .for('update');
    if (pending) await updateAudited(tx, externalPaymentRefs, pending.id, pending.rowVersion, { state: 'withdrawn' });
}

/**
 * References as a person reads them, with what helps them decide: the same reference rejected before, the same number
 * live in another year, and what a statement says of it, as far as they can see those (RLS).
 */
export async function refsOut(tx: Tx, rows: readonly RefRow[]): Promise<ExternalRefOut[]> {
    if (rows.length === 0) return [];
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const refIds = rows.map((r) => r.id);
    const [orders, units, lines, related] = await Promise.all([
        tx
            .select({ id: paymentOrders.id, caseNumber: paymentOrders.caseNumber, createdAt: paymentOrders.createdAt })
            .from(paymentOrders)
            .where(inArray(paymentOrders.id, orderIds)),
        unitRefs(
            tx,
            rows.map((r) => r.handlingUnitId)
        ),
        tx
            .select()
            .from(externalStatementLines)
            .where(
                sql`(${externalStatementLines.refId} in ${refIds}) or (${externalStatementLines.state} not in ('duplicate', 'invalid')
                     and (${externalStatementLines.issuer}, ${externalStatementLines.referenceNorm}, ${externalStatementLines.fiscalYear})
                         in (select issuer, reference_norm, fiscal_year from fees.external_payment_refs where id in ${refIds}))`
            )
            .orderBy(asc(externalStatementLines.createdAt)),
        tx
            .select({
                id: externalPaymentRefs.id,
                issuer: externalPaymentRefs.issuer,
                norm: externalPaymentRefs.referenceNorm,
                year: externalPaymentRefs.fiscalYear,
                state: externalPaymentRefs.state
            })
            .from(externalPaymentRefs)
            .where(
                sql`${externalPaymentRefs.state} in ('rejected', 'pending_verification', 'verified')
                    and (${externalPaymentRefs.issuer}, ${externalPaymentRefs.referenceNorm})
                    in (select issuer, reference_norm from fees.external_payment_refs where id in ${refIds})`
            )
    ]);
    const orderOf = new Map(orders.map((o) => [o.id, o]));
    const keyOf = (issuer: string, norm: string | null, year: number | null) => `${issuer}|${norm ?? ''}|${year ?? 0}`;
    const lineOf = new Map(lines.map((l) => [keyOf(l.issuer, l.referenceNorm, l.fiscalYear), l]));
    return rows.map((r) => {
        const key = keyOf(r.issuer, r.referenceNorm, r.fiscalYear);
        const order = orderOf.get(r.orderId);
        const line = lineOf.get(key);
        const unit = units.get(r.handlingUnitId);
        return {
            id: r.id,
            orderId: r.orderId,
            caseId: r.caseId,
            caseNumber: order?.caseNumber ?? 0,
            issuer: r.issuer,
            reference: r.reference,
            fiscalYear: r.fiscalYear,
            paidOn: r.paidOn,
            amountSantim: santimText(r.amountSantim),
            receivedFrom: r.receivedFrom,
            state: r.state,
            enteredBy: r.enteredBy,
            enteredAt: r.createdAt.toISOString(),
            decidedBy: r.decidedBy,
            decidedAt: r.decidedAt?.toISOString() ?? null,
            verifiedVia: r.verifiedVia,
            note: r.note,
            revokeReason: r.revokeReason,
            rejectedBefore: related.filter(
                (o) =>
                    o.id !== r.id &&
                    o.state === 'rejected' &&
                    o.issuer === r.issuer &&
                    o.norm === r.referenceNorm &&
                    o.year === r.fiscalYear
            ).length,
            sameNumberOtherYear: related.filter(
                (o) =>
                    o.state !== 'rejected' &&
                    o.issuer === r.issuer &&
                    o.norm === r.referenceNorm &&
                    o.year !== r.fiscalYear
            ).length,
            paidBeforeOrder: order ? r.paidOn < addisDayOf(order.createdAt) : false,
            statement: line
                ? {
                      state: line.state,
                      amountSantim: line.amountSantim === null ? null : santimText(line.amountSantim),
                      paidOn: line.paidOn
                  }
                : null,
            unit: {
                id: r.handlingUnitId,
                code: unit?.code ?? '',
                name: (unit?.name ?? { am: '', en: '' }) as I18nText
            }
        };
    });
}
