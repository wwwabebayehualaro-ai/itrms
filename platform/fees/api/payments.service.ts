/**
 * Payments, receipts and reversals at the cashier (task 0.22b, ADR-0042). A payment is the whole total of an order, at the
 * till of the case's handling office (an office whose type collects cash), by cash or a bank deposit slip; its receipt is
 * numbered in the same transaction by the office's counter (gapless per office and fiscal year: a rollback gives the number
 * back) or by the leaf of a pre-printed pad, as the office's setting says. One lock order everywhere: the case, then the
 * order, then the counter. A reversal is asked for with a reason and decided once by another person, in a role the region's
 * setting names, never the person who asked nor the cashier who took the money; approved, it voids the payment and opens
 * the order again, and the receipt keeps its number (ADR-0014). Every write is audited in its transaction.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { nextNumber } from '@itrms/kernel/numbering';
import { describeUnit, getUnit, unitRefs } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { SettingsService } from '@itrms/kernel/settings';
import { santimText, type I18nText } from '@itrms/schemas';

import {
    BANKS_SETTING,
    RECEIPT_COUNTER,
    REVERSAL_APPROVER_ROLES_SETTING,
    type PaymentInput,
    type PaymentOrderOut,
    type ReceiptOut,
    type ReversalOut
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { FEE_CASE_PORT, type FeeCasePort } from './case-port';
import { addisToday } from './fees.service';
import { paymentOrderLines, paymentOrders, payments, receiptReversals, receipts } from './fees.table';
import { factsOf, PaymentOrdersService } from './payment-orders.service';

type ReceiptRow = typeof receipts.$inferSelect;
type ReversalRow = typeof receiptReversals.$inferSelect;

const say = (language: string, key: keyof typeof en): string => (language === 'en' ? en : am)[key];

/** A slip reference as compared: upper case, without spaces or dashes ("ft 12-345" is "FT12345"). */
export const normalisedReference = (reference: string): string => reference.toUpperCase().replace(/[\s-]+/g, '');

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
};

@Injectable()
export class PaymentsService {
    constructor(
        @Inject(PaymentOrdersService) private readonly orders: PaymentOrdersService,
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Optional() @Inject(FEE_CASE_PORT) private readonly cases?: FeeCasePort
    ) {}

    /** The case locked first (the one lock order), or 409 when it is closed or cannot be read here. */
    private async lockCase(tx: Tx, caseId: string) {
        if (!this.cases) return;
        const kase = await this.cases.lock(tx, caseId);
        if (!kase) throw new NotFoundError();
        if (kase.closed) throw new ConflictError('invalid_transition', { detail: 'The case is closed.' });
    }

    /**
     * Records a payment of an order at the person's till: their office is the case's handling office and collects cash;
     * the order is open, paid at a cashier, and the amount is its total. The receipt is issued in the same transaction.
     */
    async record(
        tx: Tx,
        ctx: DbContext,
        orderId: string,
        input: PaymentInput,
        language: string
    ): Promise<{ order: PaymentOrderOut; receipt: ReceiptOut }> {
        const userId = ctx.userId ?? '';
        const [seen] = await tx
            .select({ caseId: paymentOrders.caseId, unitId: paymentOrders.handlingUnitId })
            .from(paymentOrders)
            .where(eq(paymentOrders.id, orderId));
        if (!seen) throw new NotFoundError();
        // the till is the case's office's: an office above sees the order, but takes no money for it
        if (seen.unitId !== ctx.unitId)
            throw new ForbiddenError({
                detail: say(language, 'fees.payment.otherOffice'),
                audit: { reason: 'other_office_till', order: orderId }
            });
        const unit = await describeUnit(tx, await getUnit(tx, seen.unitId));
        if (!unit.capabilities.includes('collects_cash'))
            throw new ForbiddenError({
                detail: say(language, 'fees.payment.noTill'),
                audit: { reason: 'no_till', order: orderId }
            });
        await this.lockCase(tx, seen.caseId);
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).for('update');
        if (!order) throw new NotFoundError();
        if (order.state !== 'open')
            throw new ConflictError(order.state === 'settled' ? 'already_settled' : 'invalid_transition', {
                detail: order.state === 'settled' ? 'The order is paid.' : 'The order is cancelled.'
            });
        if (order.collection !== 'cashier')
            throw new ConflictError('collected_elsewhere', { detail: 'This fee is paid elsewhere.' });
        if (input.amountSantim !== santimText(order.totalSantim))
            throw new ConflictError('amount_mismatch', {
                detail: `The order asks for ${santimText(order.totalSantim)} santim.`
            });
        const source = await this.orders.receiptSource(tx, order.handlingUnitId);
        if (source === 'pad' && !input.pad)
            throw fieldError('pad', 'required', say(language, 'fees.payment.padRequired'));
        if (source === 'itrms' && input.pad)
            throw fieldError('pad', 'invalid', say(language, 'fees.payment.padNotUsed'));
        const slip = input.bankSlip;
        if (slip) {
            const banks = await this.settings.value<{ code: string }[]>(tx, order.handlingUnitId, BANKS_SETTING);
            if (!banks.some((b) => b.code === slip.bank))
                throw fieldError('bankSlip.bank', 'invalid', say(language, 'fees.payment.unknownBank'));
            if (slip.paidOn > addisToday())
                throw fieldError('bankSlip.paidOn', 'invalid', say(language, 'fees.payment.slipFuture'));
        }

        let payment: typeof payments.$inferSelect;
        try {
            payment = await insertAudited(tx, payments, {
                regionId: order.regionId,
                handlingUnitId: order.handlingUnitId,
                orderId: order.id,
                caseId: order.caseId,
                method: input.method,
                amountSantim: order.totalSantim,
                bankCode: slip?.bank ?? null,
                slipReference: slip?.reference ?? null,
                slipReferenceNorm: slip ? normalisedReference(slip.reference) : null,
                slipDate: slip?.paidOn ?? null,
                receivedFrom: input.receivedFrom,
                receivedBy: userId
            });
        } catch (error) {
            if (isUniqueViolation(error, 'payments_slip_live_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: say(language, 'fees.payment.slipUsed'),
                    cause: error
                });
            if (isUniqueViolation(error, 'payments_order_live_uq'))
                throw new ConflictError('already_settled', { detail: 'The order is paid.', cause: error });
            throw error;
        }

        let receipt: ReceiptRow;
        try {
            if (source === 'itrms') {
                const issued = await nextNumber(tx, RECEIPT_COUNTER, order.handlingUnitId);
                receipt = await insertAudited(tx, receipts, {
                    regionId: order.regionId,
                    handlingUnitId: order.handlingUnitId,
                    paymentId: payment.id,
                    orderId: order.id,
                    caseId: order.caseId,
                    source,
                    number: issued.number,
                    fiscalYear: issued.fiscalYear ?? null,
                    sequence: issued.value,
                    amountSantim: order.totalSantim,
                    issuedBy: userId
                });
            } else {
                const pad = input.pad ?? { series: '', serial: '' };
                receipt = await insertAudited(tx, receipts, {
                    regionId: order.regionId,
                    handlingUnitId: order.handlingUnitId,
                    paymentId: payment.id,
                    orderId: order.id,
                    caseId: order.caseId,
                    source,
                    number: `${pad.series}/${pad.serial}`,
                    padSeries: pad.series,
                    padSerial: pad.serial,
                    amountSantim: order.totalSantim,
                    issuedBy: userId
                });
            }
        } catch (error) {
            if (isUniqueViolation(error, 'receipts_pad_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: say(language, 'fees.payment.padUsed'),
                    cause: error
                });
            throw error;
        }
        const settled = await updateAudited(tx, paymentOrders, order.id, order.rowVersion, {
            state: 'settled',
            settledPaymentId: payment.id
        });
        await this.cases?.paymentChanged(
            tx,
            ctx,
            order.caseId,
            {
                payment: factsOf(settled),
                action: 'paid',
                data: {
                    receiptId: receipt.id,
                    receiptNumber: receipt.number,
                    amountSantim: santimText(receipt.amountSantim)
                }
            },
            language
        );
        const where = { unitId: order.handlingUnitId, regionId: order.regionId };
        await emit(tx, 'payment.settled.v1', { orderId: order.id, caseId: order.caseId, paymentId: payment.id }, where);
        await emit(tx, 'receipt.issued.v1', { receiptId: receipt.id, caseId: order.caseId }, where);
        return {
            order: await this.orders.get(tx, order.id, order.handlingUnitId),
            receipt: await this.receipt(tx, receipt.id)
        };
    }

    async receipt(tx: Tx, id: string): Promise<ReceiptOut> {
        const [row] = await tx
            .select({ r: receipts, p: payments, o: paymentOrders })
            .from(receipts)
            .innerJoin(payments, eq(payments.id, receipts.paymentId))
            .innerJoin(paymentOrders, eq(paymentOrders.id, receipts.orderId))
            .where(eq(receipts.id, id));
        if (!row) throw new NotFoundError();
        const lines = await tx
            .select()
            .from(paymentOrderLines)
            .where(eq(paymentOrderLines.orderId, row.o.id))
            .orderBy(asc(paymentOrderLines.position));
        const unit = (await unitRefs(tx, [row.r.handlingUnitId])).get(row.r.handlingUnitId);
        const [reversed] = await tx
            .select({ id: receiptReversals.id })
            .from(receiptReversals)
            .where(and(eq(receiptReversals.receiptId, id), eq(receiptReversals.state, 'approved')));
        return {
            id: row.r.id,
            paymentId: row.r.paymentId,
            orderId: row.r.orderId,
            caseId: row.r.caseId,
            caseNumber: row.o.caseNumber,
            source: row.r.source,
            number: row.r.number,
            amountSantim: santimText(row.r.amountSantim),
            method: row.p.method,
            receivedFrom: row.p.receivedFrom,
            serviceCode: row.o.serviceCode,
            serviceName: row.o.serviceName,
            lines: lines.map((l) => ({
                key: l.key,
                label: l.label,
                quantity: l.quantity,
                amountSantim: santimText(l.amountSantim)
            })),
            unit: {
                id: row.r.handlingUnitId,
                code: unit?.code ?? '',
                name: (unit?.name ?? { am: '', en: '' }) as I18nText
            },
            issuedBy: row.r.issuedBy,
            issuedAt: row.r.createdAt.toISOString(),
            demo: row.o.demo,
            reversed: reversed !== undefined
        };
    }

    /** Asks for a receipt's reversal, with a reason: a cashier of the receipt's office; one open request at a time. */
    async requestReversal(
        tx: Tx,
        ctx: DbContext,
        receiptId: string,
        reason: string,
        language: string
    ): Promise<ReversalOut> {
        const [seen] = await tx.select().from(receipts).where(eq(receipts.id, receiptId));
        if (!seen) throw new NotFoundError();
        if (seen.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({
                detail: say(language, 'fees.payment.otherOffice'),
                audit: { reason: 'other_office_till', receipt: receiptId }
            });
        await this.lockCase(tx, seen.caseId);
        const [payment] = await tx.select().from(payments).where(eq(payments.id, seen.paymentId)).for('update');
        if (!payment) throw new NotFoundError();
        if (payment.voidedAt) throw new ConflictError('invalid_transition', { detail: 'The receipt is reversed.' });
        let row: ReversalRow;
        try {
            row = await insertAudited(tx, receiptReversals, {
                regionId: seen.regionId,
                handlingUnitId: seen.handlingUnitId,
                receiptId: seen.id,
                paymentId: payment.id,
                orderId: seen.orderId,
                caseId: seen.caseId,
                reason,
                requestedBy: ctx.userId ?? '',
                cashierId: payment.receivedBy
            });
        } catch (error) {
            if (isUniqueViolation(error, 'receipt_reversals_live_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: say(language, 'fees.reversal.pending'),
                    cause: error
                });
            throw error;
        }
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, seen.orderId));
        if (order)
            await this.cases?.paymentChanged(
                tx,
                ctx,
                seen.caseId,
                {
                    payment: factsOf(order),
                    action: 'reversal_requested',
                    data: { receiptId: seen.id, receiptNumber: seen.number, reason }
                },
                language
            );
        return this.reversal(tx, row.id);
    }

    /**
     * Decides a reversal, once: in a role the region's `fees.reversals.approverRoles` names, at the receipt's office or one
     * above it (who sees it: RLS); never the person who asked nor the cashier who took the money (refused on record; the
     * database checks it too). Approved: the payment is voided, the order open again, the case's payment unsettled.
     */
    async decide(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        input: { decision: 'approved' | 'rejected'; note?: string },
        language: string
    ): Promise<ReversalOut> {
        const [seen] = await tx.select().from(receiptReversals).where(eq(receiptReversals.id, id));
        if (!seen) throw new NotFoundError();
        const userId = ctx.userId ?? '';
        if (seen.requestedBy === userId || seen.cashierId === userId)
            throw new ForbiddenError({
                detail: say(language, 'fees.reversal.ownDecision'),
                audit: { reason: 'reversal_self_decision', reversal: id }
            });
        const approvers = await this.settings.value<string[]>(tx, seen.handlingUnitId, REVERSAL_APPROVER_ROLES_SETTING);
        if (!roles.some((r) => approvers.includes(r)))
            throw new ForbiddenError({
                detail: say(language, 'fees.reversal.notApprover'),
                audit: { reason: 'reversal_not_approver', reversal: id }
            });
        // one lock order: the case, the order, the payment, the reversal
        let closed = false;
        if (this.cases) {
            const kase = await this.cases.lock(tx, seen.caseId);
            if (!kase) throw new NotFoundError();
            closed = kase.closed;
        }
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, seen.orderId)).for('update');
        const [payment] = await tx.select().from(payments).where(eq(payments.id, seen.paymentId)).for('update');
        const [reversal] = await tx.select().from(receiptReversals).where(eq(receiptReversals.id, id)).for('update');
        if (!order || !payment || !reversal) throw new NotFoundError();
        if (reversal.state !== 'requested')
            throw new ConflictError('stale_version', { detail: 'This reversal has been decided already.' });
        const decided = await updateAudited(tx, receiptReversals, reversal.id, reversal.rowVersion, {
            state: input.decision,
            decidedBy: userId,
            decidedAt: new Date(),
            note: input.note ?? null
        });
        let now = order;
        if (input.decision === 'approved') {
            await updateAudited(tx, payments, payment.id, payment.rowVersion, {
                voidedAt: new Date(),
                voidedByReversalId: reversal.id
            });
            // the order may be paid again; a closed case's is done with
            now = await updateAudited(
                tx,
                paymentOrders,
                order.id,
                order.rowVersion,
                closed
                    ? {
                          state: 'cancelled',
                          settledPaymentId: null,
                          cancelledAt: new Date(),
                          cancelReason: 'case_closed'
                      }
                    : { state: 'open', settledPaymentId: null }
            );
            await emit(
                tx,
                'receipt.reversed.v1',
                { receiptId: reversal.receiptId, caseId: reversal.caseId, reversalId: reversal.id },
                { unitId: reversal.handlingUnitId, regionId: reversal.regionId }
            );
        }
        const [receipt] = await tx.select().from(receipts).where(eq(receipts.id, reversal.receiptId));
        if (!closed)
            await this.cases?.paymentChanged(
                tx,
                ctx,
                reversal.caseId,
                {
                    payment: factsOf(now),
                    action: input.decision === 'approved' ? 'reversed' : 'reversal_rejected',
                    data: {
                        receiptId: reversal.receiptId,
                        receiptNumber: receipt?.number ?? '',
                        note: input.note ?? null
                    }
                },
                language
            );
        return this.reversal(tx, decided.id);
    }

    /** The reversals waiting for a decision that the person sees (their office and the ones below: RLS), oldest first. */
    async reversals(tx: Tx, state: 'requested' | 'approved' | 'rejected'): Promise<ReversalOut[]> {
        const rows = await tx
            .select({ id: receiptReversals.id })
            .from(receiptReversals)
            .where(eq(receiptReversals.state, state))
            .orderBy(asc(receiptReversals.createdAt))
            .limit(200);
        return Promise.all(rows.map((r) => this.reversal(tx, r.id)));
    }

    async reversal(tx: Tx, id: string): Promise<ReversalOut> {
        const [row] = await tx
            .select({ v: receiptReversals, r: receipts, o: paymentOrders })
            .from(receiptReversals)
            .innerJoin(receipts, eq(receipts.id, receiptReversals.receiptId))
            .innerJoin(paymentOrders, eq(paymentOrders.id, receiptReversals.orderId))
            .where(eq(receiptReversals.id, id));
        if (!row) throw new NotFoundError();
        const unit = (await unitRefs(tx, [row.v.handlingUnitId])).get(row.v.handlingUnitId);
        return {
            id: row.v.id,
            receiptId: row.v.receiptId,
            receiptNumber: row.r.number,
            orderId: row.v.orderId,
            caseId: row.v.caseId,
            caseNumber: row.o.caseNumber,
            amountSantim: santimText(row.r.amountSantim),
            reason: row.v.reason,
            state: row.v.state,
            requestedBy: row.v.requestedBy,
            requestedAt: row.v.createdAt.toISOString(),
            cashierId: row.v.cashierId,
            decidedBy: row.v.decidedBy,
            decidedAt: row.v.decidedAt?.toISOString() ?? null,
            note: row.v.note,
            unit: {
                id: row.v.handlingUnitId,
                code: unit?.code ?? '',
                name: (unit?.name ?? { am: '', en: '' }) as I18nText
            }
        };
    }
}

const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });
