/**
 * Payment orders (task 0.22b, ADR-0042): a case's newest fee as an order to pay. `followFee` keeps one live order per case
 * in step with its fee (the `fees.createPaymentOrder` and `fees.assess` effects call it, in the transition's transaction,
 * which holds the case's lock): the same fee names the order it has, a new fee cancels an open order and issues the next,
 * and a paid order refuses a changed fee (its receipt is reversed first). Money is `bigint` santim.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, NotFoundError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { SettingsService } from '@itrms/kernel/settings';
import { santimText, type I18nText } from '@itrms/schemas';
import type { z } from 'zod';

import {
    RECEIPT_SOURCE_SETTING,
    type PaymentFacts,
    type PaymentOrderOut,
    type ReceiptSource,
    type paymentOrderQuerySchema
} from '../contracts';
import { addisToday, FeesService } from './fees.service';
import { caseFeeLines, paymentOrderLines, paymentOrders, payments, receiptReversals, receipts } from './fees.table';

type OrderRow = typeof paymentOrders.$inferSelect;

/** The case a fee belongs to, as an effect is given it. */
export interface OrderCase {
    caseId: string;
    caseNumber: number;
    regionId: string;
    handlingUnitId: string;
    /** the case's frozen configuration: its service, and how its fee is paid (`payment.collection`, `payment.dueDays`) */
    config: Readonly<Record<string, unknown>>;
}

const DUE_DAYS = 30;

/** The day `days` after a day (YYYY-MM-DD), on the calendar (no clock involved). */
export function dayAfter(day: string, days: number): string {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

const paymentConfig = (config: Readonly<Record<string, unknown>>) => {
    const payment = (config.payment ?? {}) as Record<string, unknown>;
    return {
        collection: payment.collection === 'elsewhere' ? ('elsewhere' as const) : ('cashier' as const),
        dueDays: typeof payment.dueDays === 'number' ? payment.dueDays : DUE_DAYS
    };
};

export const factsOf = (order: OrderRow): PaymentFacts => ({
    orderId: order.id,
    settled: order.state === 'settled',
    totalSantim: santimText(order.totalSantim),
    collection: order.collection
});

@Injectable()
export class PaymentOrdersService {
    constructor(
        @Inject(FeesService) private readonly fees: FeesService,
        @Inject(SettingsService) private readonly settings: SettingsService
    ) {}

    /** The case's live order (not cancelled), locked. */
    async live(tx: Tx, caseId: string): Promise<OrderRow | undefined> {
        const [row] = await tx
            .select()
            .from(paymentOrders)
            .where(and(eq(paymentOrders.caseId, caseId), ne(paymentOrders.state, 'cancelled')))
            .for('update');
        return row;
    }

    /**
     * The order for the case's fee as it is now: none for a case without a fee (settled, nothing to pay); the order it
     * has when the fee is the one it was issued for (an effect run twice makes one order); a new one when the fee changed
     * (an open order cancelled first); 409 `fee_already_paid` when a paid order's fee changed.
     */
    async followFee(tx: Tx, kase: OrderCase): Promise<PaymentFacts> {
        const fee = await this.fees.forCase(tx, kase.caseId);
        const order = await this.live(tx, kase.caseId);
        const { collection, dueDays } = paymentConfig(kase.config);
        if (!fee || fee.totalSantim === '0') {
            if (order?.state === 'settled')
                throw new ConflictError('fee_already_paid', { detail: 'The fee is paid; reverse its receipt first.' });
            if (order) await this.cancel(tx, order, 'reassessed');
            return { orderId: null, settled: true, totalSantim: '0', collection };
        }
        if (order && order.caseFeeId === fee.id) return factsOf(order);
        if (order?.state === 'settled')
            throw new ConflictError('fee_already_paid', { detail: 'The fee is paid; reverse its receipt first.' });
        if (order) await this.cancel(tx, order, 'reassessed');
        const created = await insertAudited(tx, paymentOrders, {
            regionId: kase.regionId,
            handlingUnitId: kase.handlingUnitId,
            caseId: kase.caseId,
            caseNumber: kase.caseNumber,
            serviceCode: typeof kase.config.serviceCode === 'string' ? kase.config.serviceCode : '',
            serviceName: (kase.config.serviceName ?? { am: '', en: '' }) as I18nText,
            caseFeeId: fee.id,
            totalSantim: BigInt(fee.totalSantim),
            demo: fee.demo,
            collection,
            dueOn: dayAfter(addisToday(), dueDays)
        });
        const lines = await tx
            .select()
            .from(caseFeeLines)
            .where(eq(caseFeeLines.caseFeeId, fee.id))
            .orderBy(asc(caseFeeLines.position));
        for (const line of lines)
            await insertAudited(tx, paymentOrderLines, {
                regionId: kase.regionId,
                handlingUnitId: kase.handlingUnitId,
                orderId: created.id,
                position: line.position,
                key: line.key,
                label: line.label,
                quantity: line.quantity,
                amountSantim: line.amountSantim
            });
        return factsOf(created);
    }

    private cancel(tx: Tx, order: OrderRow, reason: 'reassessed' | 'case_closed') {
        return updateAudited(tx, paymentOrders, order.id, order.rowVersion, {
            state: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: reason
        });
    }

    /** A closed case's open order is cancelled (nothing more is paid for it); a paid one stays as it is. */
    async cancelForClosedCase(tx: Tx, caseId: string): Promise<boolean> {
        const order = await this.live(tx, caseId);
        if (order?.state !== 'open') return false;
        await this.cancel(tx, order, 'case_closed');
        return true;
    }

    /** Where the office's receipt numbers come from now. */
    receiptSource(tx: Tx, unitId: string): Promise<ReceiptSource> {
        return this.settings.value<ReceiptSource>(tx, unitId, RECEIPT_SOURCE_SETTING);
    }

    /** The cashier's queue: the orders of the person's office paid at its till, oldest first. */
    async list(tx: Tx, ctx: DbContext, query: z.infer<typeof paymentOrderQuerySchema>): Promise<PaymentOrderOut[]> {
        const conditions = [
            eq(paymentOrders.handlingUnitId, ctx.unitId ?? ''),
            eq(paymentOrders.state, query.state),
            eq(paymentOrders.collection, 'cashier'),
            query.q === undefined ? undefined : eq(paymentOrders.caseNumber, query.q),
            query.after === undefined ? undefined : gt(paymentOrders.id, query.after)
        ].filter((c) => c !== undefined);
        const rows = await tx
            .select()
            .from(paymentOrders)
            .where(and(...conditions))
            .orderBy(asc(paymentOrders.id))
            .limit(query.limit);
        return this.out(tx, rows, ctx.unitId ?? '');
    }

    async get(tx: Tx, id: string, unitId: string): Promise<PaymentOrderOut> {
        const [row] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, id));
        if (!row) throw new NotFoundError();
        const [out] = await this.out(tx, [row], unitId);
        if (!out) throw new NotFoundError();
        return out;
    }

    /** The case's newest order (the case page's payment panel), or null. */
    async forCase(tx: Tx, caseId: string, unitId: string): Promise<PaymentOrderOut | null> {
        const [row] = await tx
            .select()
            .from(paymentOrders)
            .where(eq(paymentOrders.caseId, caseId))
            .orderBy(desc(paymentOrders.createdAt), desc(paymentOrders.id))
            .limit(1);
        if (!row) return null;
        const [out] = await this.out(tx, [row], unitId);
        return out ?? null;
    }

    private async out(tx: Tx, rows: OrderRow[], unitId: string): Promise<PaymentOrderOut[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const [lines, paid, issued, reversals, units] = await Promise.all([
            tx
                .select()
                .from(paymentOrderLines)
                .where(inArray(paymentOrderLines.orderId, ids))
                .orderBy(asc(paymentOrderLines.position)),
            tx.select().from(payments).where(inArray(payments.orderId, ids)).orderBy(asc(payments.createdAt)),
            tx.select().from(receipts).where(inArray(receipts.orderId, ids)),
            tx
                .select()
                .from(receiptReversals)
                .where(inArray(receiptReversals.orderId, ids))
                .orderBy(asc(receiptReversals.createdAt)),
            unitRefs(
                tx,
                rows.map((r) => r.handlingUnitId)
            )
        ]);
        const source = await this.receiptSource(tx, unitId || (rows[0]?.handlingUnitId ?? ''));
        const today = addisToday();
        const receiptOf = new Map(issued.map((r) => [r.paymentId, r]));
        const numberOf = new Map(issued.map((r) => [r.id, r.number]));
        return rows.map((row) => {
            const unit = units.get(row.handlingUnitId) ?? {
                id: row.handlingUnitId,
                code: '',
                name: { am: '', en: '' }
            };
            return {
                id: row.id,
                caseId: row.caseId,
                caseNumber: row.caseNumber,
                serviceCode: row.serviceCode,
                serviceName: row.serviceName,
                state: row.state,
                collection: row.collection,
                totalSantim: santimText(row.totalSantim),
                demo: row.demo,
                dueOn: row.dueOn,
                overdue: row.state === 'open' && row.dueOn < today,
                lines: lines
                    .filter((l) => l.orderId === row.id)
                    .map((l) => ({
                        key: l.key,
                        label: l.label,
                        quantity: l.quantity,
                        amountSantim: santimText(l.amountSantim)
                    })),
                unit: { id: unit.id, code: unit.code, name: unit.name as I18nText },
                createdAt: row.createdAt.toISOString(),
                cancelReason: row.cancelReason ?? null,
                payments: paid
                    .filter((p) => p.orderId === row.id)
                    .map((p) => ({
                        id: p.id,
                        method: p.method,
                        amountSantim: santimText(p.amountSantim),
                        receivedFrom: p.receivedFrom,
                        bank: p.bankCode,
                        slipReference: p.slipReference,
                        slipDate: p.slipDate,
                        receivedBy: p.receivedBy,
                        receivedAt: p.createdAt.toISOString(),
                        voided: p.voidedAt !== null,
                        receiptId: receiptOf.get(p.id)?.id ?? null,
                        receiptNumber: receiptOf.get(p.id)?.number ?? null
                    })),
                reversals: reversals
                    .filter((r) => r.orderId === row.id)
                    .map((r) => ({
                        id: r.id,
                        receiptId: r.receiptId,
                        receiptNumber: numberOf.get(r.receiptId) ?? '',
                        orderId: r.orderId,
                        caseId: r.caseId,
                        caseNumber: row.caseNumber,
                        amountSantim: santimText(row.totalSantim),
                        reason: r.reason,
                        state: r.state,
                        requestedBy: r.requestedBy,
                        requestedAt: r.createdAt.toISOString(),
                        cashierId: r.cashierId,
                        decidedBy: r.decidedBy,
                        decidedAt: r.decidedAt?.toISOString() ?? null,
                        note: r.note,
                        unit: { id: unit.id, code: unit.code, name: unit.name as I18nText }
                    })),
                receiptSource: source
            };
        });
    }
}
