/**
 * The remittance (task 1.12d, ADR-0063 §5): the office takes the closed cashier sessions up to a day to the bank. It covers
 * every closed session of the acting office not yet remitted, its receipts as they stood in the figures the first count froze,
 * and the reversals decided after a till was counted as negative lines under the receipt's account (Finance refunds them); what
 * goes to the bank is the counted cash less the floats that stay in the tills. The lines are frozen copies, under the account
 * codes of the region's setting. Lock order (ADR-0063 §3): the office's remittance lock, the sessions in id order, the counter,
 * then the inserts. Every write is audited in its transaction; the database checks the sums at commit (migration 0095).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, inArray, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { insertAudited, insertManyAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { unitRefs } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { SettingsService } from '@itrms/kernel/settings';
import { santimText, type I18nText } from '@itrms/schemas';

import {
    ACCOUNTS_SETTING,
    BANKS_SETTING,
    REMITTANCE_COUNTER,
    type AccountsSetting,
    type RemittanceDepositInput,
    type RemittanceDetail,
    type RemittanceGroupOut,
    type RemittanceLineOut,
    type RemittanceOut,
    type RemittancePreview,
    type RemittanceSessionOut,
    type RemittanceState
} from '../contracts';
import { cashierSessionCounts, cashierSessions } from './cashier-sessions.table';
import { addisToday } from './fees.service';
import { paymentOrderLines, payments, receiptReversals, receipts } from './fees.table';
import {
    buildRemittance,
    depositFigures,
    groupLines,
    type BuiltLine,
    type LateReversalInput,
    type LineGroup,
    type ReceiptLineInput,
    type RemittanceTotals
} from './remittance-build';
import { remittanceLines, remittances, remittanceSessions } from './remittances.table';

type RemittanceRow = typeof remittances.$inferSelect;
type SessionRow = typeof cashierSessions.$inferSelect;

const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
};

/** A reference compared: trimmed, in capitals, without spaces. */
export const normalisedDepositReference = (reference: string): string =>
    reference.trim().toUpperCase().replace(/\s+/g, '');

/** What a prepare would write, from the rows (the preview stores none of it). */
interface Gathered {
    unitId: string;
    sessions: SessionRow[];
    /** a covered session's closing count: the cash counted */
    counted: Map<string, bigint>;
    notYetClosed: SessionRow[];
    receiptNumbers: Map<string, string>;
    lines: BuiltLine[];
    totals: RemittanceTotals;
    depositDue: bigint;
    difference: bigint;
    accounts: AccountsSetting;
}

@Injectable()
export class RemittancesService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    /** One preparer at a time per office: the lock is the transaction's (the sessions' unique key is the backstop). */
    private async serialise(tx: Tx, unitId: string): Promise<void> {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`remittance:${unitId}`}, 0))`);
    }

    private assertThrough(through: string) {
        if (through > addisToday()) throw fieldError('through', 'in_future', 'is a day that has not come yet');
    }

    /** The sessions, receipts and reversals a remittance up to a day would carry, with its figures. */
    private async gather(tx: Tx, ctx: DbContext, through: string, lock: boolean): Promise<Gathered> {
        const unitId = ctx.unitId ?? '';
        const unclaimed = and(
            eq(cashierSessions.handlingUnitId, unitId),
            eq(cashierSessions.state, 'closed'),
            lte(cashierSessions.businessDay, through),
            notExists(
                tx
                    .select({ one: sql`1` })
                    .from(remittanceSessions)
                    .where(eq(remittanceSessions.sessionId, cashierSessions.id))
            )
        );
        // the sessions held exclusively, in id order (a reversal's decision holds its session in share mode)
        const covering = tx.select().from(cashierSessions).where(unclaimed).orderBy(asc(cashierSessions.id));
        const sessions = lock ? await covering.for('update') : await covering;
        const notYetClosed = await tx
            .select()
            .from(cashierSessions)
            .where(
                and(
                    eq(cashierSessions.handlingUnitId, unitId),
                    ne(cashierSessions.state, 'closed'),
                    lte(cashierSessions.businessDay, through)
                )
            )
            .orderBy(asc(cashierSessions.businessDay), asc(cashierSessions.id));
        const accounts = await this.settings.value<AccountsSetting>(tx, unitId, ACCOUNTS_SETTING);

        const ids = sessions.map((s) => s.id);
        const counted = new Map<string, bigint>();
        const receiptLines: ReceiptLineInput[] = [];
        const receiptNumbers = new Map<string, string>();
        const late: LateReversalInput[] = [];
        if (ids.length > 0) {
            const counts = await tx
                .select({ id: cashierSessionCounts.id, counted: cashierSessionCounts.countedSantim })
                .from(cashierSessionCounts)
                .where(
                    inArray(
                        cashierSessionCounts.id,
                        sessions.flatMap((s) => (s.closingCountId ? [s.closingCountId] : []))
                    )
                );
            for (const s of sessions) {
                const c = counts.find((x) => x.id === s.closingCountId);
                if (!c) throw new Error(`remittance: the session ${s.id} is closed without its count`);
                counted.set(s.id, c.counted);
            }
            // the receipts the first count froze: the session's payments not voided, and those voided after the till was counted
            // (the same set as the figures frozen, migration 0094: voided_at null at the count)
            const taken = await tx
                .select({
                    receiptId: receipts.id,
                    number: receipts.number,
                    method: payments.method,
                    position: paymentOrderLines.position,
                    key: paymentOrderLines.key,
                    amount: paymentOrderLines.amountSantim
                })
                .from(payments)
                .innerJoin(receipts, eq(receipts.paymentId, payments.id))
                .innerJoin(paymentOrderLines, eq(paymentOrderLines.orderId, payments.orderId))
                .where(
                    and(
                        inArray(payments.sessionId, ids),
                        or(
                            isNull(payments.voidedAt),
                            exists(
                                tx
                                    .select({ one: sql`1` })
                                    .from(receiptReversals)
                                    .where(
                                        and(
                                            eq(receiptReversals.id, payments.voidedByReversalId),
                                            eq(receiptReversals.afterTillClosed, true)
                                        )
                                    )
                            )
                        )
                    )
                )
                .orderBy(asc(receipts.createdAt), asc(receipts.id), asc(paymentOrderLines.position));
            for (const t of taken) {
                receiptNumbers.set(t.receiptId, t.number);
                receiptLines.push({
                    receiptId: t.receiptId,
                    orderLinePosition: t.position,
                    lineKey: t.key,
                    method: t.method,
                    amountSantim: t.amount
                });
            }
        }
        // the reversals decided after a till was counted, not on any remittance yet, of a receipt remitted now or before
        const earlier = alias(remittanceLines, 'earlier');
        const claimed = alias(remittanceLines, 'claimed');
        const reversed = await tx
            .select({
                reversalId: receiptReversals.id,
                receiptId: receiptReversals.receiptId,
                number: receipts.number,
                sessionId: payments.sessionId,
                method: payments.method,
                position: paymentOrderLines.position,
                key: paymentOrderLines.key,
                amount: paymentOrderLines.amountSantim,
                frozen: {
                    accountCode: earlier.accountCode,
                    budgetCategory: earlier.budgetCategory,
                    accountName: earlier.accountName,
                    mappedByDefault: earlier.mappedByDefault
                }
            })
            .from(receiptReversals)
            .innerJoin(payments, eq(payments.id, receiptReversals.paymentId))
            .innerJoin(receipts, eq(receipts.id, receiptReversals.receiptId))
            .innerJoin(paymentOrderLines, eq(paymentOrderLines.orderId, receiptReversals.orderId))
            .leftJoin(
                earlier,
                and(
                    eq(earlier.receiptId, receiptReversals.receiptId),
                    eq(earlier.orderLinePosition, paymentOrderLines.position),
                    eq(earlier.kind, 'receipt')
                )
            )
            .where(
                and(
                    eq(receiptReversals.handlingUnitId, unitId),
                    eq(receiptReversals.state, 'approved'),
                    eq(receiptReversals.afterTillClosed, true),
                    notExists(
                        tx
                            .select({ one: sql`1` })
                            .from(claimed)
                            .where(eq(claimed.reversalId, receiptReversals.id))
                    ),
                    or(ids.length > 0 ? inArray(payments.sessionId, ids) : sql`false`, sql`${earlier.id} is not null`)
                )
            )
            .orderBy(asc(receiptReversals.decidedAt), asc(receiptReversals.id), asc(paymentOrderLines.position));
        for (const v of reversed) {
            receiptNumbers.set(v.receiptId, v.number);
            late.push({
                reversalId: v.reversalId,
                receiptId: v.receiptId,
                orderLinePosition: v.position,
                lineKey: v.key,
                method: v.method,
                amountSantim: v.amount,
                ...(v.frozen?.accountCode != null && v.frozen.accountName != null
                    ? {
                          frozen: {
                              accountCode: v.frozen.accountCode,
                              budgetCategory: v.frozen.budgetCategory ?? '',
                              accountName: v.frozen.accountName,
                              mappedByDefault: v.frozen.mappedByDefault ?? false
                          }
                      }
                    : {})
            });
        }
        const built = buildRemittance(receiptLines, late, accounts);
        const { depositDue, difference } = depositFigures(
            sessions.map((s) => ({
                openingFloatSantim: s.openingFloatSantim,
                expectedSantim: s.expectedCashSantim ?? 0n,
                countedSantim: counted.get(s.id) ?? 0n
            }))
        );
        return {
            unitId,
            sessions,
            counted,
            notYetClosed,
            receiptNumbers,
            lines: built.lines,
            totals: built.totals,
            depositDue,
            difference,
            accounts
        };
    }

    private sessionOuts(g: Gathered): RemittanceSessionOut[] {
        return g.sessions.map((s) => ({
            id: s.id,
            cashierId: s.cashierId,
            businessDay: s.businessDay,
            openingFloatSantim: santimText(s.openingFloatSantim),
            cashReceiptsSantim: santimText(s.cashReceiptsSantim ?? 0n),
            bankSlipSantim: santimText(s.bankSlipSantim ?? 0n),
            receiptCount: s.receiptCount ?? 0,
            expectedCashSantim: santimText(s.expectedCashSantim ?? 0n),
            countedSantim: santimText(g.counted.get(s.id) ?? 0n),
            differenceSantim: ((g.counted.get(s.id) ?? 0n) - (s.expectedCashSantim ?? 0n)).toString()
        }));
    }

    private groupOuts(groups: readonly LineGroup[]): RemittanceGroupOut[] {
        return groups.map((g) => ({
            accountCode: g.accountCode,
            budgetCategory: g.budgetCategory,
            accountName: g.accountName,
            mappedByDefault: g.mappedByDefault,
            receiptSantim: g.receipt.toString(),
            reversalSantim: g.reversal.toString(),
            totalSantim: (g.receipt + g.reversal).toString(),
            lineCount: g.lineCount
        }));
    }

    /** What a prepare up to this day would give, nothing stored, and the sessions it leaves out. */
    async preview(tx: Tx, ctx: DbContext, through: string): Promise<RemittancePreview> {
        this.assertThrough(through);
        const g = await this.gather(tx, ctx, through, false);
        const today = addisToday();
        return {
            through,
            periodFrom: g.sessions[0]
                ? g.sessions.reduce((d, s) => (s.businessDay < d ? s.businessDay : d), g.sessions[0].businessDay)
                : null,
            revenueTotalSantim: g.totals.revenueTotal.toString(),
            cashSantim: santimText(g.totals.cash),
            bankSlipSantim: santimText(g.totals.bankSlip),
            reversalSantim: g.totals.reversal.toString(),
            differenceSantim: g.difference.toString(),
            depositDueSantim: g.depositDue < 0n ? '0' : santimText(g.depositDue),
            demo: g.accounts.demo,
            sessions: this.sessionOuts(g),
            groups: this.groupOuts(groupLines(g.lines)),
            lineCount: g.lines.length,
            notYetClosed: g.notYetClosed.map((s) => ({
                id: s.id,
                cashierId: s.cashierId,
                businessDay: s.businessDay,
                state: s.state,
                overdue: s.businessDay < today
            }))
        };
    }

    /** Prepares the remittance of the closed sessions up to a day: the number from the office's counter, in this transaction. */
    async prepare(tx: Tx, ctx: DbContext, through: string): Promise<RemittanceDetail> {
        this.assertThrough(through);
        const unitId = ctx.unitId ?? '';
        const regionId = ctx.regionId ?? '';
        await this.serialise(tx, unitId);
        const g = await this.gather(tx, ctx, through, true);
        const first = g.sessions.reduce<string | null>(
            (d, s) => (d === null || s.businessDay < d ? s.businessDay : d),
            null
        );
        if (first === null)
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.nothing_to_remit' });
        if (g.depositDue < 0n)
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.remittance_negative_due' });
        const issued = await nextNumber(tx, REMITTANCE_COUNTER, unitId);
        let row: RemittanceRow;
        try {
            row = await insertAudited(tx, remittances, {
                regionId,
                handlingUnitId: unitId,
                number: issued.number,
                fiscalYear: issued.fiscalYear ?? 0,
                sequence: issued.value,
                periodFrom: first,
                periodTo: through,
                revenueTotalSantim: g.totals.revenueTotal,
                cashSantim: g.totals.cash,
                bankSlipSantim: g.totals.bankSlip,
                reversalSantim: g.totals.reversal,
                differenceSantim: g.difference,
                depositDueSantim: g.depositDue,
                preparedBy: ctx.userId ?? '',
                demo: g.accounts.demo
            });
            await insertManyAudited(
                tx,
                remittanceSessions,
                g.sessions.map((s) => ({ regionId, handlingUnitId: unitId, remittanceId: row.id, sessionId: s.id }))
            );
            await insertManyAudited(
                tx,
                remittanceLines,
                g.lines.map((l) => ({
                    regionId,
                    handlingUnitId: unitId,
                    remittanceId: row.id,
                    kind: l.kind,
                    receiptId: l.receiptId,
                    reversalId: l.reversalId,
                    orderLinePosition: l.orderLinePosition,
                    lineKey: l.lineKey,
                    accountCode: l.accountCode,
                    budgetCategory: l.budgetCategory,
                    accountName: l.accountName,
                    mappedByDefault: l.mappedByDefault,
                    paymentMethod: l.paymentMethod,
                    amountSantim: l.amountSantim
                }))
            );
        } catch (error) {
            // two prepares at once over the same session or reversal: the other won
            if (
                isUniqueViolation(error, 'remittance_sessions_session_uq') ||
                isUniqueViolation(error, 'remittance_lines_receipt_uq') ||
                isUniqueViolation(error, 'remittance_lines_reversal_uq')
            )
                throw new ConflictError('invalid_transition', {
                    detailKey: 'fees.errors.nothing_to_remit',
                    cause: error
                });
            throw error;
        }
        await emit(tx, 'remittance.prepared.v1', { remittanceId: row.id }, { unitId, regionId });
        return this.detail(tx, row.id);
    }

    /**
     * Records the bank's deposit slip, once, for exactly the amount due: by the office whose remittance it is. The slip's reference
     * is unique in the office.
     */
    async deposit(tx: Tx, ctx: DbContext, id: string, input: RemittanceDepositInput): Promise<RemittanceDetail> {
        const [seen] = await tx.select().from(remittances).where(eq(remittances.id, id));
        if (!seen) throw new NotFoundError();
        if (seen.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({
                detailKey: 'fees.errors.remittance_other_office',
                audit: { reason: 'remittance_other_office', remittance: id }
            });
        const banks = await this.settings.value<{ code: string }[]>(tx, seen.handlingUnitId, BANKS_SETTING);
        if (!banks.some((b) => b.code === input.bank))
            throw fieldError('bank', 'invalid', 'is not a bank of this region');
        const reference = normalisedDepositReference(input.reference);
        if (reference.length < 3) throw fieldError('reference', 'invalid', 'is too short to compare');
        if (input.depositedOn > addisToday())
            throw fieldError('depositedOn', 'invalid', 'is a day that has not come yet');
        const [row] = await tx.select().from(remittances).where(eq(remittances.id, id)).for('update');
        if (!row) throw new NotFoundError();
        if (row.state !== 'prepared')
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.deposit_recorded' });
        if (BigInt(input.amountSantim) !== row.depositDueSantim)
            throw new ConflictError('amount_mismatch', {
                detailKey: 'fees.errors.remittance_amount_mismatch',
                params: { due: santimText(row.depositDueSantim) }
            });
        try {
            await updateAudited(tx, remittances, row.id, row.rowVersion, {
                state: 'deposited',
                depositBank: input.bank,
                depositReference: input.reference.trim(),
                depositReferenceNorm: reference,
                depositedOn: input.depositedOn,
                depositedAmountSantim: row.depositDueSantim,
                depositedBy: ctx.userId ?? null,
                depositedAt: new Date()
            });
        } catch (error) {
            if (isUniqueViolation(error, 'remittances_deposit_reference_uq'))
                throw new ConflictError('duplicate_reference', {
                    detailKey: 'fees.errors.deposit_reference_taken',
                    cause: error
                });
            throw error;
        }
        return this.detail(tx, row.id);
    }

    private async outs(tx: Tx, rows: RemittanceRow[]): Promise<RemittanceOut[]> {
        if (rows.length === 0) return [];
        const units = await unitRefs(tx, [...new Set(rows.map((r) => r.handlingUnitId))]);
        const counts = await tx
            .select({ id: remittanceSessions.remittanceId, n: sql<number>`count(*)::int` })
            .from(remittanceSessions)
            .where(
                inArray(
                    remittanceSessions.remittanceId,
                    rows.map((r) => r.id)
                )
            )
            .groupBy(remittanceSessions.remittanceId);
        return rows.map((r) => {
            const unit = units.get(r.handlingUnitId);
            return {
                id: r.id,
                number: r.number,
                state: r.state,
                periodFrom: r.periodFrom,
                periodTo: r.periodTo,
                revenueTotalSantim: r.revenueTotalSantim.toString(),
                cashSantim: santimText(r.cashSantim),
                bankSlipSantim: santimText(r.bankSlipSantim),
                reversalSantim: r.reversalSantim.toString(),
                differenceSantim: r.differenceSantim.toString(),
                depositDueSantim: santimText(r.depositDueSantim),
                sessionCount: counts.find((c) => c.id === r.id)?.n ?? 0,
                preparedBy: r.preparedBy,
                preparedAt: r.preparedAt.toISOString(),
                deposit:
                    r.depositedAt && r.depositBank && r.depositReference && r.depositedOn && r.depositedBy
                        ? {
                              bank: r.depositBank,
                              reference: r.depositReference,
                              depositedOn: r.depositedOn,
                              amountSantim: santimText(r.depositedAmountSantim ?? 0n),
                              depositedBy: r.depositedBy,
                              depositedAt: r.depositedAt.toISOString()
                          }
                        : null,
                demo: r.demo,
                unit: {
                    id: r.handlingUnitId,
                    code: unit?.code ?? '',
                    name: (unit?.name ?? { am: '', en: '' }) as I18nText
                }
            };
        });
    }

    /** The office's remittances and those below it, newest first, keyset by id. */
    async list(tx: Tx, query: { state?: RemittanceState; after?: string; limit: number }) {
        const conditions = [];
        if (query.state) conditions.push(eq(remittances.state, query.state));
        if (query.after) {
            const [cursor] = await tx.select().from(remittances).where(eq(remittances.id, query.after));
            if (cursor)
                conditions.push(
                    sql`(${remittances.preparedAt}, ${remittances.id}) < (${cursor.preparedAt}, ${cursor.id})`
                );
        }
        const rows = await tx
            .select()
            .from(remittances)
            .where(and(...conditions))
            .orderBy(desc(remittances.preparedAt), desc(remittances.id))
            .limit(query.limit);
        return { items: await this.outs(tx, rows) };
    }

    /** One remittance with its sessions and lines (read only). */
    async detail(tx: Tx, id: string): Promise<RemittanceDetail> {
        const [row] = await tx.select().from(remittances).where(eq(remittances.id, id));
        if (!row) throw new NotFoundError();
        const [out] = await this.outs(tx, [row]);
        if (!out) throw new NotFoundError();
        const covered = await tx
            .select({ s: cashierSessions, counted: cashierSessionCounts.countedSantim })
            .from(remittanceSessions)
            .innerJoin(cashierSessions, eq(cashierSessions.id, remittanceSessions.sessionId))
            .leftJoin(cashierSessionCounts, eq(cashierSessionCounts.id, cashierSessions.closingCountId))
            .where(eq(remittanceSessions.remittanceId, id))
            .orderBy(asc(cashierSessions.businessDay), asc(cashierSessions.id));
        const lines = await tx
            .select({ l: remittanceLines, number: receipts.number })
            .from(remittanceLines)
            .innerJoin(receipts, eq(receipts.id, remittanceLines.receiptId))
            .where(eq(remittanceLines.remittanceId, id))
            .orderBy(
                asc(remittanceLines.kind),
                asc(receipts.createdAt),
                asc(receipts.id),
                asc(remittanceLines.orderLinePosition)
            );
        const lineOuts: RemittanceLineOut[] = lines.map(({ l, number }) => ({
            id: l.id,
            kind: l.kind,
            receiptId: l.receiptId,
            receiptNumber: number,
            reversalId: l.reversalId,
            orderLinePosition: l.orderLinePosition,
            lineKey: l.lineKey,
            accountCode: l.accountCode,
            budgetCategory: l.budgetCategory,
            accountName: l.accountName,
            mappedByDefault: l.mappedByDefault,
            paymentMethod: l.paymentMethod,
            amountSantim: l.amountSantim.toString()
        }));
        return {
            ...out,
            sessions: covered.map(({ s, counted }) => ({
                id: s.id,
                cashierId: s.cashierId,
                businessDay: s.businessDay,
                openingFloatSantim: santimText(s.openingFloatSantim),
                cashReceiptsSantim: santimText(s.cashReceiptsSantim ?? 0n),
                bankSlipSantim: santimText(s.bankSlipSantim ?? 0n),
                receiptCount: s.receiptCount ?? 0,
                expectedCashSantim: santimText(s.expectedCashSantim ?? 0n),
                countedSantim: santimText(counted ?? 0n),
                differenceSantim: ((counted ?? 0n) - (s.expectedCashSantim ?? 0n)).toString()
            })),
            groups: this.groupOuts(
                groupLines(
                    lines.map(({ l }) => ({
                        accountCode: l.accountCode,
                        budgetCategory: l.budgetCategory,
                        accountName: l.accountName,
                        mappedByDefault: l.mappedByDefault,
                        kind: l.kind,
                        amountSantim: l.amountSantim
                    }))
                )
            ),
            lines: lineOuts
        };
    }
}
