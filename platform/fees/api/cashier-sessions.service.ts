/**
 * Cashier sessions and the daily closing (task 1.12, ADR-0063). A session is one cashier's, at one office, on one business
 * day. The first payment of the day opens it (a float of zero) unless the cashier opened it with a float; the cashier counts
 * the till, and the first count freezes what the session expects (the float and its cash not voided). A count that matches
 * closes it; a difference needs a note and another person's decision, in a role the region names, never the cashier; a
 * rejected count is made again. The lock order extends ADR-0042: the case, the order, the cashier session, the counter, the
 * payment, the receipt, the reversal. A payment and a reversal's decision hold the session in share mode, a count and a count's
 * decision exclusively. Every write is audited in its transaction.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { santimText } from '@itrms/schemas';

import {
    DENOMINATIONS_SETTING,
    denominationTotal,
    SESSION_APPROVER_ROLES_SETTING,
    type CashierSessionDetail,
    type CashierSessionOut,
    type SessionCountInput,
    type SessionCountOut,
    type SessionState
} from '../contracts/cashier-sessions';
import { cashierSessionCounts, cashierSessions } from './cashier-sessions.table';
import { addisToday } from './fees.service';
import { externalPaymentRefs, payments, receiptReversals } from './fees.table';
import { stationeryClosings } from './stationery.table';

type SessionRow = typeof cashierSessions.$inferSelect;
type CountRow = typeof cashierSessionCounts.$inferSelect;

const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
};

const countOut = (c: CountRow): SessionCountOut => ({
    id: c.id,
    attempt: c.attempt,
    countedSantim: santimText(c.countedSantim),
    expectedSantim: santimText(c.expectedSantim),
    differenceSantim: c.differenceSantim.toString(),
    denominations: c.denominations,
    note: c.note,
    countedBy: c.countedBy,
    countedAt: c.createdAt.toISOString(),
    state: c.state,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote
});

@Injectable()
export class CashierSessionsService {
    constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

    /** One writer at a time opens a cashier's session of a day: the lock is the transaction's. */
    private async serialise(tx: Tx, unitId: string, cashierId: string, day: string): Promise<void> {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`cashier-session:${unitId}:${cashierId}:${day}`}, 0))`
        );
    }

    private async openToday(tx: Tx, unitId: string, cashierId: string, day: string, lock: 'share' | 'update') {
        const [row] = await tx
            .select()
            .from(cashierSessions)
            .where(
                and(
                    eq(cashierSessions.handlingUnitId, unitId),
                    eq(cashierSessions.cashierId, cashierId),
                    eq(cashierSessions.businessDay, day),
                    eq(cashierSessions.state, 'open')
                )
            )
            .for(lock);
        return row;
    }

    /**
     * The session a payment of today joins: the cashier's open one at this office, held in share mode; the first payment of the
     * day opens one with a float of zero. A count racing with the payment leaves the session not open: a new one is opened.
     */
    async joinToday(tx: Tx, regionId: string, unitId: string, cashierId: string): Promise<string> {
        const day = addisToday();
        const found = await this.openToday(tx, unitId, cashierId, day, 'share');
        if (found) return found.id;
        await this.serialise(tx, unitId, cashierId, day);
        const again = await this.openToday(tx, unitId, cashierId, day, 'share');
        if (again) return again.id;
        const created = await insertAudited(tx, cashierSessions, {
            regionId,
            handlingUnitId: unitId,
            cashierId,
            businessDay: day,
            openingFloatSantim: 0n,
            openedVia: 'payment'
        });
        return created.id;
    }

    /** Whether a payment's session was counted (a reversal then is a line of the remittance): none is not. */
    async sessionLockedShared(tx: Tx, sessionId: string | null): Promise<SessionRow | undefined> {
        if (!sessionId) return undefined;
        const [row] = await tx.select().from(cashierSessions).where(eq(cashierSessions.id, sessionId)).for('share');
        return row;
    }

    /** Opens today's session with a float; refused when the cashier has one open today. */
    async open(tx: Tx, ctx: DbContext, openingFloatSantim: string): Promise<CashierSessionOut> {
        const unitId = ctx.unitId ?? '';
        const regionId = ctx.regionId ?? '';
        const userId = ctx.userId ?? '';
        const day = addisToday();
        await this.serialise(tx, unitId, userId, day);
        if (await this.openToday(tx, unitId, userId, day, 'update'))
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.session_already_open' });
        let row: SessionRow;
        try {
            row = await insertAudited(tx, cashierSessions, {
                regionId,
                handlingUnitId: unitId,
                cashierId: userId,
                businessDay: day,
                openingFloatSantim: BigInt(openingFloatSantim),
                openedVia: 'explicit'
            });
        } catch (error) {
            if (isUniqueViolation(error, 'cashier_sessions_open_uq'))
                throw new ConflictError('invalid_transition', {
                    detailKey: 'fees.errors.session_already_open',
                    cause: error
                });
            throw error;
        }
        return (await this.outs(tx, [row]))[0] as CashierSessionOut;
    }

    /**
     * The cashier's count of the till. The first count freezes what is expected; a difference needs a note. Allowed while the
     * session is open or counted again after a rejection, and only by the session's cashier.
     */
    async count(tx: Tx, ctx: DbContext, sessionId: string, input: SessionCountInput): Promise<CashierSessionDetail> {
        const userId = ctx.userId ?? '';
        const [seen] = await tx.select().from(cashierSessions).where(eq(cashierSessions.id, sessionId));
        if (!seen) throw new NotFoundError();
        if (seen.cashierId !== userId || seen.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({
                detailKey: 'fees.errors.session_not_yours',
                audit: { reason: 'session_not_own_till', session: sessionId }
            });
        const counted = BigInt(input.countedSantim);
        if (input.denominations && denominationTotal(input.denominations) !== counted)
            throw fieldError('denominations', 'sum_mismatch', 'does not add up to the counted total');
        const [session] = await tx
            .select()
            .from(cashierSessions)
            .where(eq(cashierSessions.id, sessionId))
            .for('update');
        if (!session) throw new NotFoundError();
        if (session.state !== 'open' && session.state !== 'counting')
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.session_not_countable' });

        let expected = session.expectedCashSantim;
        let frozen: Partial<typeof cashierSessions.$inferInsert> = {};
        if (session.state === 'open') {
            const live = await this.figures(tx, [session.id]);
            const f = live.get(session.id) ?? { cash: 0n, slip: 0n, receipts: 0 };
            expected = session.openingFloatSantim + f.cash;
            frozen = {
                tillClosedAt: new Date(),
                cashReceiptsSantim: f.cash,
                bankSlipSantim: f.slip,
                receiptCount: f.receipts,
                expectedCashSantim: expected
            };
        }
        if (expected === null)
            throw new ConflictError('invalid_transition', { detailKey: 'fees.errors.session_not_countable' });
        const difference = counted - expected;
        const note = input.note && input.note.length > 0 ? input.note : null;
        if (difference !== 0n && (note === null || note.length < 10))
            throw fieldError('note', 'required', 'explain the difference (10 to 500 characters)');

        const [last] = await tx
            .select({ attempt: cashierSessionCounts.attempt })
            .from(cashierSessionCounts)
            .where(eq(cashierSessionCounts.sessionId, session.id))
            .orderBy(desc(cashierSessionCounts.attempt))
            .limit(1);
        const row = await insertAudited(tx, cashierSessionCounts, {
            regionId: session.regionId,
            handlingUnitId: session.handlingUnitId,
            sessionId: session.id,
            attempt: (last?.attempt ?? 0) + 1,
            cashierId: session.cashierId,
            countedSantim: counted,
            denominations: input.denominations ?? null,
            expectedSantim: expected,
            differenceSantim: difference,
            note: difference === 0n ? null : note,
            countedBy: userId,
            state: difference === 0n ? 'balanced' : 'pending'
        });
        await updateAudited(
            tx,
            cashierSessions,
            session.id,
            session.rowVersion,
            difference === 0n
                ? { ...frozen, state: 'closed', closingCountId: row.id, closedAt: new Date() }
                : { ...frozen, state: 'pending_approval' }
        );
        return this.detail(tx, session.id);
    }

    /**
     * Decides a count with a difference, once: in a role the region's `fees.sessions.approverRoles` names, at the office or one
     * above it (who sees it: RLS), never the cashier who counted (refused on record; the database checks it too).
     */
    async decide(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        countId: string,
        input: { decision: 'approve' | 'reject'; note?: string }
    ): Promise<CashierSessionDetail> {
        const userId = ctx.userId ?? '';
        const [seen] = await tx.select().from(cashierSessionCounts).where(eq(cashierSessionCounts.id, countId));
        if (!seen) throw new NotFoundError();
        if (seen.cashierId === userId || seen.countedBy === userId)
            throw new ForbiddenError({
                detailKey: 'fees.errors.session_own_decision',
                audit: { reason: 'session_self_decision', count: countId }
            });
        const approvers = await this.settings.value<string[]>(tx, seen.handlingUnitId, SESSION_APPROVER_ROLES_SETTING);
        if (!roles.some((r) => approvers.includes(r)))
            throw new ForbiddenError({
                detailKey: 'fees.errors.session_not_approver',
                audit: { reason: 'session_not_approver', count: countId }
            });
        const note = input.note && input.note.length > 0 ? input.note : null;
        if (input.decision === 'reject' && (note === null || note.length < 3))
            throw fieldError('note', 'required', 'say why the count is rejected');
        const [session] = await tx
            .select()
            .from(cashierSessions)
            .where(eq(cashierSessions.id, seen.sessionId))
            .for('update');
        const [count] = await tx
            .select()
            .from(cashierSessionCounts)
            .where(eq(cashierSessionCounts.id, countId))
            .for('update');
        if (!session || !count) throw new NotFoundError();
        if (count.state !== 'pending' || session.state !== 'pending_approval')
            throw new ConflictError('stale_version', { detailKey: 'fees.errors.count_already_decided' });
        await updateAudited(tx, cashierSessionCounts, count.id, count.rowVersion, {
            state: input.decision === 'approve' ? 'approved' : 'rejected',
            decidedBy: userId,
            decidedAt: new Date(),
            decisionNote: note
        });
        await updateAudited(
            tx,
            cashierSessions,
            session.id,
            session.rowVersion,
            input.decision === 'approve'
                ? { state: 'closed', closingCountId: count.id, closedAt: new Date() }
                : { state: 'counting' }
        );
        return this.detail(tx, session.id);
    }

    /** Cash, bank slip money and receipts not voided, per session. */
    private async figures(tx: Tx, ids: readonly string[]) {
        const out = new Map<string, { cash: bigint; slip: bigint; receipts: number }>();
        if (ids.length === 0) return out;
        const rows = await tx
            .select({
                id: payments.sessionId,
                cash: sql<string>`coalesce(sum(${payments.amountSantim}) filter (where ${payments.method} = 'cash'), 0)::text`,
                slip: sql<string>`coalesce(sum(${payments.amountSantim}) filter (where ${payments.method} = 'bank_slip'), 0)::text`,
                receipts: sql<number>`count(*)::int`
            })
            .from(payments)
            .where(and(inArray(payments.sessionId, [...ids]), isNull(payments.voidedAt)))
            .groupBy(payments.sessionId);
        for (const r of rows)
            if (r.id) out.set(r.id, { cash: BigInt(r.cash), slip: BigInt(r.slip), receipts: r.receipts });
        return out;
    }

    private async outs(tx: Tx, rows: SessionRow[]): Promise<CashierSessionOut[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const live = await this.figures(
            tx,
            rows.filter((r) => r.state === 'open').map((r) => r.id)
        );
        const counts = await tx
            .select()
            .from(cashierSessionCounts)
            .where(inArray(cashierSessionCounts.sessionId, ids))
            .orderBy(asc(cashierSessionCounts.attempt));
        const units = await unitRefs(tx, [...new Set(rows.map((r) => r.handlingUnitId))]);
        const today = addisToday();
        return rows.map((r) => {
            const f = live.get(r.id) ?? { cash: 0n, slip: 0n, receipts: 0 };
            const frozen = r.tillClosedAt !== null;
            const cash = frozen ? (r.cashReceiptsSantim ?? 0n) : f.cash;
            return {
                id: r.id,
                cashierId: r.cashierId,
                businessDay: r.businessDay,
                state: r.state,
                openedVia: r.openedVia,
                openedAt: r.createdAt.toISOString(),
                openingFloatSantim: santimText(r.openingFloatSantim),
                overdue: r.businessDay < today && (r.state === 'open' || r.state === 'counting'),
                cashReceiptsSantim: santimText(cash),
                bankSlipSantim: santimText(frozen ? (r.bankSlipSantim ?? 0n) : f.slip),
                receiptCount: frozen ? (r.receiptCount ?? 0) : f.receipts,
                expectedCashSantim: santimText(frozen ? (r.expectedCashSantim ?? 0n) : r.openingFloatSantim + cash),
                tillClosedAt: r.tillClosedAt?.toISOString() ?? null,
                closedAt: r.closedAt?.toISOString() ?? null,
                unit: { id: r.handlingUnitId, code: units.get(r.handlingUnitId)?.code ?? '' },
                counts: counts.filter((c) => c.sessionId === r.id).map(countOut)
            };
        });
    }

    /** The person's own sessions of today and the earlier days' ones they have not closed. */
    async current(tx: Tx, ctx: DbContext) {
        const userId = ctx.userId ?? '';
        const today = addisToday();
        const rows = await tx
            .select()
            .from(cashierSessions)
            .where(
                and(
                    eq(cashierSessions.cashierId, userId),
                    eq(cashierSessions.handlingUnitId, ctx.unitId ?? ''),
                    or(
                        eq(cashierSessions.businessDay, today),
                        and(
                            lt(cashierSessions.businessDay, today),
                            inArray(cashierSessions.state, ['open', 'counting'] satisfies SessionState[])
                        )
                    )
                )
            )
            .orderBy(desc(cashierSessions.businessDay), desc(cashierSessions.createdAt))
            .limit(30);
        const out = await this.outs(tx, rows);
        return {
            businessDay: today,
            today: out.filter((s) => s.businessDay === today),
            overdue: out.filter((s) => s.overdue)
        };
    }

    /**
     * Sessions the person sees, newest first, keyset by id: all of the office and below for an approver, else their own.
     */
    async list(
        tx: Tx,
        ctx: DbContext,
        scope: 'own' | 'all',
        query: { state?: SessionState; after?: string; limit: number }
    ) {
        const conditions = [];
        if (scope === 'own') conditions.push(eq(cashierSessions.cashierId, ctx.userId ?? ''));
        if (query.state) conditions.push(eq(cashierSessions.state, query.state));
        if (query.after) {
            const [cursor] = await tx.select().from(cashierSessions).where(eq(cashierSessions.id, query.after));
            if (cursor)
                conditions.push(
                    sql`(${cashierSessions.businessDay}, ${cashierSessions.createdAt}, ${cashierSessions.id}) < (${cursor.businessDay}, ${cursor.createdAt}, ${cursor.id})`
                );
        }
        const rows = await tx
            .select()
            .from(cashierSessions)
            .where(and(...conditions))
            .orderBy(desc(cashierSessions.businessDay), desc(cashierSessions.createdAt), desc(cashierSessions.id))
            .limit(query.limit);
        return { items: await this.outs(tx, rows) };
    }

    /** One session with what the closing screen shows beside it (read only). */
    async detail(tx: Tx, id: string, ctx?: DbContext, scope: 'own' | 'all' = 'all'): Promise<CashierSessionDetail> {
        const [row] = await tx.select().from(cashierSessions).where(eq(cashierSessions.id, id));
        if (!row || (scope === 'own' && row.cashierId !== (ctx?.userId ?? ''))) throw new NotFoundError();
        const [out] = await this.outs(tx, [row]);
        if (!out) throw new NotFoundError();
        const [voided] = await tx
            .select({
                n: sql<number>`count(*)::int`,
                total: sql<string>`coalesce(sum(${payments.amountSantim}), 0)::text`
            })
            .from(payments)
            .where(and(eq(payments.sessionId, id), sql`${payments.voidedAt} is not null`));
        const [reversals] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(receiptReversals)
            .innerJoin(payments, eq(payments.id, receiptReversals.paymentId))
            .where(and(eq(payments.sessionId, id), eq(receiptReversals.state, 'requested')));
        const [refs] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(externalPaymentRefs)
            .where(
                and(
                    eq(externalPaymentRefs.handlingUnitId, row.handlingUnitId),
                    eq(externalPaymentRefs.enteredBy, row.cashierId),
                    eq(externalPaymentRefs.state, 'pending_verification'),
                    sql`(${externalPaymentRefs.createdAt} at time zone 'Africa/Addis_Ababa')::date = ${row.businessDay}::date`
                )
            );
        const leaves = await tx
            .select()
            .from(stationeryClosings)
            .where(and(eq(stationeryClosings.unitId, row.handlingUnitId), eq(stationeryClosings.kind, 'receipt_leaf')))
            .orderBy(desc(stationeryClosings.closedOn))
            .limit(3);
        return {
            ...out,
            voidedReceiptCount: voided?.n ?? 0,
            voidedSantim: santimText(BigInt(voided?.total ?? '0')),
            pendingReversals: reversals?.n ?? 0,
            pendingExternalRefs: refs?.n ?? 0,
            receiptLeafClosings: leaves.map((l) => ({
                closedOn: l.closedOn,
                expected: l.expected,
                counted: l.counted,
                missingCount: l.missingCount
            })),
            denominations: await this.settings.value<number[]>(tx, row.handlingUnitId, DENOMINATIONS_SETTING)
        };
    }
}
