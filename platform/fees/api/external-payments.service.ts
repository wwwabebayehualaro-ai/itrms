/**
 * Money paid elsewhere (task 0.22c, ADR-0043). The counter enters the receipt or reference of an order a revenue office or
 * a bank collects; it settles the order only once verified, by a person other than who entered it (a role the region's
 * `fees.external.verifierRoles` names), or by a statement's line (the worker, handlers/statements.ts). One lock order: the
 * case, the order, the reference. A verified reference that proves wrong is revoked by a third person, with a reason, while
 * its case is open. Statements are taken here and read by the worker.
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { SettingsService } from '@itrms/kernel/settings';
import { santimText, type I18nText } from '@itrms/schemas';
import type { z } from 'zod';

import {
    EXTERNAL_ISSUERS_SETTING,
    EXTERNAL_VERIFIER_ROLES_SETTING,
    MAX_STATEMENT_BYTES,
    STATEMENT_LAYOUT,
    type ExternalIssuer,
    type ExternalRefDecision,
    type ExternalRefInput,
    type ExternalRefOut,
    type StatementImport,
    type StatementLineOut,
    type StatementOut,
    type externalRefQuerySchema,
    type statementLineQuerySchema
} from '../contracts';
import { FEE_CASE_PORT, type FeeCasePort } from './case-port';
import { settleByReference } from './external-settlement';
import { addisDayOf, externalReferenceKey, fiscalYearDays, fiscalYearOfDay, refsOut } from './external-refs';
import { addisToday } from './fees.service';
import { externalPaymentRefs, externalStatementLines, externalStatements, paymentOrders } from './fees.table';
import { factsOf, say } from './payment-orders.service';
import { headerProblem } from './statement-layouts';

type RefRow = typeof externalPaymentRefs.$inferSelect;

const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });

const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
};

/** A statement as it is read: never its file, which only the worker needs. */
const STATEMENT_COLUMNS = {
    id: externalStatements.id,
    handlingUnitId: externalStatements.handlingUnitId,
    issuer: externalStatements.issuer,
    statementDate: externalStatements.statementDate,
    filename: externalStatements.filename,
    layout: externalStatements.layout,
    state: externalStatements.state,
    failure: externalStatements.failure,
    importedBy: externalStatements.importedBy,
    createdAt: externalStatements.createdAt
};
type StatementRow = Omit<
    typeof externalStatements.$inferSelect,
    'content' | 'sha256' | 'regionId' | 'orgPath' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'rowVersion'
>;

@Injectable()
export class ExternalPaymentsService {
    constructor(
        @Inject(SettingsService) private readonly settings: SettingsService,
        @Optional() @Inject(FEE_CASE_PORT) private readonly cases?: FeeCasePort
    ) {}

    issuers(tx: Tx, ctx: DbContext): Promise<ExternalIssuer[]> {
        return this.settings.value<ExternalIssuer[]>(tx, ctx.unitId ?? '', EXTERNAL_ISSUERS_SETTING);
    }

    private async lockCase(tx: Tx, caseId: string, language: string): Promise<{ closed: boolean } | null> {
        if (!this.cases) return null;
        const kase = await this.cases.lock(tx, caseId);
        if (!kase) throw new NotFoundError();
        if (kase.closed)
            throw new ConflictError('invalid_transition', { detail: say(language, 'fees.payment.caseClosed') });
        return kase;
    }

    /**
     * Enters the reference of the money paid for an order, at the case's office: the order's whole total, from an issuer the
     * region names, paid by today. It waits for its verification; the worker looks for it on the statements.
     */
    async enter(
        tx: Tx,
        ctx: DbContext,
        orderId: string,
        input: ExternalRefInput,
        language: string
    ): Promise<ExternalRefOut> {
        const [seen] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, orderId));
        if (!seen) throw new NotFoundError();
        if (seen.handlingUnitId !== ctx.unitId)
            throw new ForbiddenError({
                detail: say(language, 'fees.external.otherOffice'),
                audit: { reason: 'other_office_reference', order: orderId }
            });
        await this.lockCase(tx, seen.caseId, language);
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).for('update');
        if (!order) throw new NotFoundError();
        if (order.state !== 'open')
            throw new ConflictError(order.state === 'settled' ? 'already_settled' : 'invalid_transition', {
                detail: say(
                    language,
                    order.state === 'settled' ? 'fees.payment.orderPaid' : 'fees.payment.orderCancelled'
                )
            });
        if (order.collection !== 'elsewhere')
            throw new ConflictError('invalid_transition', { detail: say(language, 'fees.external.atTheTill') });
        if (input.amountSantim !== santimText(order.totalSantim))
            throw new ConflictError('amount_mismatch', { detail: say(language, 'fees.payment.amountMismatch') });
        const issuers = await this.settings.value<{ code: string }[]>(
            tx,
            order.handlingUnitId,
            EXTERNAL_ISSUERS_SETTING
        );
        if (!issuers.some((i) => i.code === input.issuer))
            throw fieldError('issuer', 'invalid', say(language, 'fees.external.unknownIssuer'));
        const key = externalReferenceKey(input.reference);
        if (key === '') throw fieldError('reference', 'invalid', say(language, 'fees.external.invalid.reference'));
        if (input.paidOn > addisToday())
            throw fieldError('paidOn', 'invalid', say(language, 'fees.external.paidOnFuture'));
        // the year is in the key: a date moved to an older year must not make the same receipt another reference
        const year = fiscalYearOfDay(input.paidOn);
        if (year < fiscalYearOfDay(addisDayOf(order.createdAt)))
            throw fieldError('paidOn', 'invalid', say(language, 'fees.external.paidOnOldYear'));

        // the same deposit taken at a till as a slip: another office's, past this request's RLS
        const { first, last } = fiscalYearDays(year);
        const used = await tx.execute<{ used: boolean }>(
            sql`select fees.slip_in_use(${input.issuer}, ${key}, ${first}::date, ${last}::date) as used`
        );
        if (used.rows[0]?.used)
            throw new ConflictError('duplicate_reference', { detail: say(language, 'fees.external.referenceUsed') });

        let ref: RefRow;
        try {
            ref = await insertAudited(tx, externalPaymentRefs, {
                regionId: order.regionId,
                handlingUnitId: order.handlingUnitId,
                orderId: order.id,
                caseId: order.caseId,
                issuer: input.issuer,
                reference: input.reference,
                referenceNorm: key,
                fiscalYear: year,
                paidOn: input.paidOn,
                amountSantim: order.totalSantim,
                receivedFrom: input.receivedFrom,
                enteredBy: ctx.userId ?? ''
            });
        } catch (error) {
            if (isUniqueViolation(error, 'external_payment_refs_key_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: say(language, 'fees.external.referenceUsed'),
                    cause: error
                });
            if (isUniqueViolation(error, 'external_payment_refs_order_live_uq'))
                throw new ConflictError('invalid_transition', {
                    detail: say(language, 'fees.external.oneWaits'),
                    cause: error
                });
            throw error;
        }
        await emit(
            tx,
            'external-payment.entered.v1',
            { refId: ref.id },
            { unitId: ref.handlingUnitId, regionId: ref.regionId }
        );
        await this.cases?.paymentChanged(
            tx,
            ctx,
            ref.caseId,
            {
                payment: factsOf(order),
                action: 'reference_entered',
                data: { receiptId: null, receiptNumber: `${ref.issuer}/${ref.reference}`, note: null }
            },
            language
        );
        return this.ref(tx, ref.id);
    }

    /**
     * Decides a reference, once: in a role the region names, at its office or above (RLS); never the person who entered it
     * (refused on record; the database checks it too). Verified, it settles the order and moves the case on; rejected, with
     * a reason, its key is free again and the counter may enter another.
     */
    async decide(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        input: ExternalRefDecision,
        language: string
    ): Promise<ExternalRefOut> {
        const seen = await this.visible(tx, id);
        if (seen.enteredBy === ctx.userId)
            throw new ForbiddenError({
                detail: say(language, 'fees.external.ownDecision'),
                audit: { reason: 'external_ref_self_decision', ref: id }
            });
        await this.mustVerify(tx, roles, seen, language, id);
        await this.lockCase(tx, seen.caseId, language);
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, seen.orderId)).for('update');
        const [ref] = await tx.select().from(externalPaymentRefs).where(eq(externalPaymentRefs.id, id)).for('update');
        if (!order || !ref) throw new NotFoundError();
        if (ref.state !== 'pending_verification')
            throw new ConflictError('stale_version', { detail: say(language, 'fees.external.alreadyDecided') });
        if (input.decision === 'verified') {
            await settleByReference(tx, ctx, this.cases, {
                order,
                ref,
                via: 'person',
                language,
                ...(input.note ? { note: input.note } : {})
            });
        } else {
            await updateAudited(tx, externalPaymentRefs, ref.id, ref.rowVersion, {
                state: 'rejected',
                decidedBy: ctx.userId ?? null,
                decidedAt: new Date(),
                note: input.note ?? null
            });
            await this.cases?.paymentChanged(
                tx,
                ctx,
                ref.caseId,
                {
                    payment: factsOf(order),
                    action: 'reference_rejected',
                    data: {
                        receiptId: null,
                        receiptNumber: `${ref.issuer}/${ref.reference}`,
                        note: input.note ?? null
                    }
                },
                language
            );
        }
        return this.ref(tx, id);
    }

    /**
     * Takes a verified reference back, with a reason, by a third person in the verifier's role: never who entered it nor who
     * verified it. The order is open again and the case's payment unsettled; its key is free, and a statement's line it
     * matched may match again. A closed case's is refused: its service was given (as a reversal, ADR-0042).
     */
    async revoke(
        tx: Tx,
        ctx: DbContext,
        roles: readonly string[],
        id: string,
        reason: string,
        language: string
    ): Promise<ExternalRefOut> {
        const seen = await this.visible(tx, id);
        if (seen.enteredBy === ctx.userId || seen.decidedBy === ctx.userId)
            throw new ForbiddenError({
                detail: say(language, 'fees.external.ownRevocation'),
                audit: { reason: 'external_ref_self_revocation', ref: id }
            });
        await this.mustVerify(tx, roles, seen, language, id);
        await this.lockCase(tx, seen.caseId, language);
        const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, seen.orderId)).for('update');
        const [ref] = await tx.select().from(externalPaymentRefs).where(eq(externalPaymentRefs.id, id)).for('update');
        if (!order || !ref) throw new NotFoundError();
        if (ref.state !== 'verified')
            throw new ConflictError('invalid_transition', { detail: say(language, 'fees.external.notVerified') });
        await updateAudited(tx, externalPaymentRefs, ref.id, ref.rowVersion, {
            state: 'revoked',
            revokedBy: ctx.userId ?? null,
            revokedAt: new Date(),
            revokeReason: reason
        });
        const now = await updateAudited(tx, paymentOrders, order.id, order.rowVersion, {
            state: 'open',
            settledExternalRefId: null
        });
        // a line it matched never verifies this number again by itself: else re-entering it undoes the revocation. A person
        // decides from here. A line this person can't see stays matched, which verifies nothing either.
        const lines = await tx.select().from(externalStatementLines).where(eq(externalStatementLines.refId, ref.id));
        for (const line of lines)
            await updateAudited(tx, externalStatementLines, line.id, line.rowVersion, {
                state: 'held',
                reason: 'reference_revoked'
            });
        await this.cases?.paymentChanged(
            tx,
            ctx,
            ref.caseId,
            {
                payment: factsOf(now),
                action: 'reference_revoked',
                data: { receiptId: null, receiptNumber: `${ref.issuer}/${ref.reference}`, reason }
            },
            language
        );
        return this.ref(tx, id);
    }

    private async mustVerify(tx: Tx, roles: readonly string[], ref: RefRow, language: string, id: string) {
        const verifiers = await this.settings.value<string[]>(tx, ref.handlingUnitId, EXTERNAL_VERIFIER_ROLES_SETTING);
        if (!roles.some((r) => verifiers.includes(r)))
            throw new ForbiddenError({
                detail: say(language, 'fees.external.notVerifier'),
                audit: { reason: 'external_ref_not_verifier', ref: id }
            });
    }

    private async visible(tx: Tx, id: string): Promise<RefRow> {
        const [row] = await tx.select().from(externalPaymentRefs).where(eq(externalPaymentRefs.id, id));
        if (!row) throw new NotFoundError();
        return row;
    }

    /** The references the person sees (their office and the ones below), oldest first. */
    async list(tx: Tx, query: z.infer<typeof externalRefQuerySchema>): Promise<ExternalRefOut[]> {
        const rows = await tx
            .select()
            .from(externalPaymentRefs)
            .where(
                and(
                    eq(externalPaymentRefs.state, query.state),
                    query.after === undefined ? undefined : gt(externalPaymentRefs.id, query.after)
                )
            )
            .orderBy(asc(externalPaymentRefs.id))
            .limit(query.limit);
        return refsOut(tx, rows);
    }

    async ref(tx: Tx, id: string): Promise<ExternalRefOut> {
        const [out] = await refsOut(tx, [await this.visible(tx, id)]);
        if (!out) throw new NotFoundError();
        return out;
    }

    /**
     * Takes a statement in the person's office. The same file is taken once per issuer; the first line is checked here, so
     * a wrong file is told at once, and the worker reads the lines (never in a request).
     */
    async importStatement(tx: Tx, ctx: DbContext, input: StatementImport, language: string): Promise<StatementOut> {
        const unitId = ctx.unitId ?? '';
        const regionId = ctx.regionId ?? '';
        const issuers = await this.settings.value<{ code: string }[]>(tx, unitId, EXTERNAL_ISSUERS_SETTING);
        if (!issuers.some((i) => i.code === input.issuer))
            throw fieldError('issuer', 'invalid', say(language, 'fees.external.unknownIssuer'));
        if (Buffer.byteLength(input.content, 'utf8') > MAX_STATEMENT_BYTES)
            throw fieldError('content', 'too_big', say(language, 'fees.statement.tooBig'));
        if (input.statementDate > addisToday())
            throw fieldError('statementDate', 'invalid', say(language, 'fees.statement.future'));
        if (headerProblem(input.content))
            throw fieldError('content', 'invalid', say(language, 'fees.statement.badHeader'));
        let row: typeof externalStatements.$inferSelect;
        try {
            row = await insertAudited(tx, externalStatements, {
                regionId,
                handlingUnitId: unitId,
                issuer: input.issuer,
                statementDate: input.statementDate,
                filename: input.filename,
                layout: STATEMENT_LAYOUT,
                sha256: createHash('sha256').update(input.content, 'utf8').digest('hex'),
                content: input.content,
                importedBy: ctx.userId ?? ''
            });
        } catch (error) {
            if (isUniqueViolation(error, 'external_statements_file_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: say(language, 'fees.statement.already'),
                    cause: error
                });
            throw error;
        }
        await emit(tx, 'external-statement.received.v1', { statementId: row.id }, { unitId, regionId });
        return this.statement(tx, row.id);
    }

    /** The statements the person sees, newest first, with how far each got. */
    async statements(tx: Tx, limit: number): Promise<StatementOut[]> {
        const rows = await tx
            .select(STATEMENT_COLUMNS)
            .from(externalStatements)
            .orderBy(desc(externalStatements.createdAt))
            .limit(limit);
        return this.statementsOut(tx, rows);
    }

    async statement(tx: Tx, id: string): Promise<StatementOut> {
        const rows = await tx.select(STATEMENT_COLUMNS).from(externalStatements).where(eq(externalStatements.id, id));
        const [out] = await this.statementsOut(tx, rows);
        if (!out) throw new NotFoundError();
        return out;
    }

    private async statementsOut(tx: Tx, rows: StatementRow[]): Promise<StatementOut[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const [counts, units] = await Promise.all([
            tx
                .select({
                    statementId: externalStatementLines.statementId,
                    state: externalStatementLines.state,
                    n: sql<number>`count(*)::int`
                })
                .from(externalStatementLines)
                .where(inArray(externalStatementLines.statementId, ids))
                .groupBy(externalStatementLines.statementId, externalStatementLines.state),
            unitRefs(
                tx,
                rows.map((r) => r.handlingUnitId)
            )
        ]);
        return rows.map((r) => {
            const unit = units.get(r.handlingUnitId);
            return {
                id: r.id,
                issuer: r.issuer,
                statementDate: r.statementDate,
                filename: r.filename,
                layout: r.layout,
                state: r.state,
                failure: r.failure,
                importedBy: r.importedBy,
                importedAt: r.createdAt.toISOString(),
                counts: Object.fromEntries(counts.filter((c) => c.statementId === r.id).map((c) => [c.state, c.n])),
                unit: {
                    id: r.handlingUnitId,
                    code: unit?.code ?? '',
                    name: (unit?.name ?? { am: '', en: '' }) as I18nText
                }
            };
        });
    }

    /** A statement's lines in file order: by default what needs a person, without the matched ones. */
    async statementLines(
        tx: Tx,
        statementId: string,
        query: z.infer<typeof statementLineQuerySchema>
    ): Promise<StatementLineOut[]> {
        await this.statement(tx, statementId);
        const rows = await tx
            .select()
            .from(externalStatementLines)
            .where(
                and(
                    eq(externalStatementLines.statementId, statementId),
                    gt(externalStatementLines.lineNo, query.after),
                    query.all ? undefined : sql`${externalStatementLines.state} <> 'matched'`
                )
            )
            .orderBy(asc(externalStatementLines.lineNo))
            .limit(query.limit);
        return rows.map((l) => ({
            id: l.id,
            lineNo: l.lineNo,
            reference: l.reference,
            amountSantim: l.amountSantim === null ? null : santimText(l.amountSantim),
            paidOn: l.paidOn,
            state: l.state,
            reason: l.reason,
            refId: l.refId
        }));
    }
}
