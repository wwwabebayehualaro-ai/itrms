/**
 * The fee of a request (ADR-0041, task 0.22a): worked out with the form engine's evaluator, the same function for the
 * preview at the counter and for the filing, on the day in Addis Ababa (the server's, never a client's). A case keeps
 * what it was assessed (`case_fees`, append-only): number 1 when the request is filed, one more each time a correction
 * changes it. Money is `bigint` santim throughout.
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { addisDate } from '@itrms/ethiopian-calendar';
import { insertAudited, type Tx } from '@itrms/kernel/db';
import { ConflictError, ValidationError } from '@itrms/kernel/errors';
import { evaluateFee, type FeeResult } from '@itrms/form-engine/core';
import { submissions } from '@itrms/forms/api';
import { santimText } from '@itrms/schemas';

import type { CaseFee, FeeLineOut, FeePreview, FeeShown } from '../contracts';
import { FeeRulesService, type ApprovedFeeRule } from './fee-rules.service';
import { caseFeeLines, caseFees } from './fees.table';
import type { FeeRequest } from './request-source';
import am from '../messages/am.json';
import en from '../messages/en.json';

const needsAnswer = (language: string): string => (language === 'en' ? en : am)['fees.validation.needsAnswer'];
const notShown = (language: string): string => (language === 'en' ? en : am)['fees.validation.notShown'];

type CaseFeeRow = typeof caseFees.$inferSelect;

/** Today in Addis Ababa (YYYY-MM-DD). */
export function addisToday(now = new Date()): string {
    const d = addisDate(now);
    return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

const linesOut = (result: Extract<FeeResult, { status: 'complete' }>): FeeLineOut[] =>
    result.lines.map((l) => ({
        key: l.key,
        label: l.label,
        quantity: l.quantity,
        amountSantim: santimText(l.amount)
    }));

/** The form keys a rule reads (its answer inputs, through the map): a change to another answer never changes the fee. */
const inputKeysOf = (rule: ApprovedFeeRule, inputMap: Record<string, string>): string[] =>
    Object.entries(rule.rule.inputs)
        .filter(([, i]) => i.from === 'answer')
        .map(([key]) => inputMap[key] ?? key)
        .sort();

@Injectable()
export class FeesService {
    constructor(@Inject(FeeRulesService) private readonly rules: FeeRulesService) {}

    /** A request's fee as filing would work it out now (nothing is stored). */
    async preview(tx: Tx, request: FeeRequest, asOf = addisToday()): Promise<FeePreview> {
        const base = {
            serviceVersionId: request.serviceVersionId,
            feeRuleVersionId: request.feeRuleVersionId,
            asOf,
            lines: [],
            totalSantim: null,
            missing: [],
            problem: null
        };
        if (request.feeRuleVersionId === null) return { ...base, status: 'none', demo: false, inputKeys: [] };
        const usable = await this.rules.usable(tx, request.feeRuleVersionId);
        if (!usable.ok) return { ...base, status: 'unavailable', demo: false, inputKeys: [], problem: usable.problem };
        const rule = usable.rule;
        const result = evaluateFee(rule.rule, { answers: request.answers, asOf, inputMap: request.inputMap });
        const common = { ...base, demo: rule.demo, inputKeys: inputKeysOf(rule, request.inputMap) };
        if (result.status === 'incomplete')
            return {
                ...common,
                status: 'incomplete',
                missing: result.missing.map((k) => request.inputMap[k] ?? k)
            };
        if (result.status === 'failed')
            return { ...common, status: 'unavailable', problem: result.problems[0]?.code ?? 'failed' };
        return { ...common, status: 'complete', lines: linesOut(result), totalSantim: santimText(result.total) };
    }

    /**
     * The fee of a request just filed with its case, kept as the case's first assessment: refused (422, no case) when it
     * cannot be worked out, and (409) when the counter showed another figure (`shown`): the clerk sees the new one first.
     * `mustShow`: the request has a form showing the fee, so a filing that sends no figure shown is refused (422): a case
     * is never filed at a fee the clerk did not see.
     */
    async assessFiled(
        tx: Tx,
        target: { caseId: string; regionId: string; handlingUnitId: string; submissionId: string | null },
        request: FeeRequest & { feeRuleVersionId: string },
        shown: FeeShown | undefined,
        language: string,
        mustShow = false
    ): Promise<CaseFee> {
        if (mustShow && shown === undefined)
            throw new ValidationError('validation_failed', {
                detailKey: 'fees.errors.fee_not_shown',
                errors: [{ path: 'fee', code: 'fee_not_shown', message: notShown(language) }]
            });
        const asOf = addisToday();
        const usable = await this.rules.usable(tx, request.feeRuleVersionId);
        if (!usable.ok) throw new ConflictError('not_configured', { detailKey: 'fees.errors.rule_not_chargeable' });
        const result = evaluateFee(usable.rule.rule, { answers: request.answers, asOf, inputMap: request.inputMap });
        if (result.status !== 'complete')
            throw new ValidationError('validation_failed', {
                detailKey: 'fees.errors.fee_not_computable',
                errors: (result.status === 'incomplete'
                    ? result.missing.map((k) => request.inputMap[k] ?? k)
                    : ['answers']
                ).map((path) => ({
                    path,
                    code: 'fee_not_computable',
                    message: needsAnswer(language)
                }))
            });
        if (
            shown !== undefined &&
            (shown.ruleVersionId !== request.feeRuleVersionId || shown.totalSantim !== santimText(result.total))
        )
            throw new ConflictError('fee_changed', {
                detailKey: 'fees.errors.fee_changed',
                params: { now: santimText(result.total), shown: String(shown.totalSantim) }
            });
        return this.keep(tx, target, usable.rule, request.inputMap, asOf, 'filed', 1, result);
    }

    /**
     * A corrected request's fee worked out again (the `fees.assess` effect): on the version the case was filed on, over
     * the request's answers as they are now, counting to the filing day or today as the rule says. A new assessment only
     * when the figure changed, at the case's handling unit now. Nothing for a case without a fee; a fee'd case whose
     * request cannot be read here refuses the transition (never a correction that silently keeps the old fee).
     */
    async reassess(tx: Tx, caseId: string, handlingUnitId: string, language = 'am'): Promise<CaseFee | null> {
        const first = await this.assessment(tx, caseId, 'first');
        const latest = await this.assessment(tx, caseId, 'latest');
        if (!first || !latest) return null;
        const rule = await this.rules.stored(tx, first.feeRuleVersionId);
        const [request] = first.submissionId
            ? await tx
                  .select({ answers: submissions.answers })
                  .from(submissions)
                  .where(eq(submissions.id, first.submissionId))
            : [{ answers: {} }];
        if (!request) throw new ConflictError('not_configured', { detailKey: 'fees.errors.request_unreadable' });
        const asOf = rule.rule.reassessAsOf === 'filing' ? first.asOf : addisToday();
        const result = evaluateFee(rule.rule, { answers: request.answers, asOf, inputMap: first.inputMap });
        if (result.status !== 'complete')
            throw new ValidationError('validation_failed', {
                detailKey: 'fees.errors.fee_not_computable_corrected',
                errors: [{ path: 'answers', code: 'fee_not_computable', message: needsAnswer(language) }]
            });
        const before = await this.out(tx, latest);
        const now = linesOut(result);
        if (before.totalSantim === santimText(result.total) && JSON.stringify(before.lines) === JSON.stringify(now))
            return before;
        return this.keep(
            tx,
            { caseId, regionId: first.regionId, handlingUnitId, submissionId: first.submissionId },
            rule,
            first.inputMap,
            asOf,
            'amended',
            latest.number + 1,
            result
        );
    }

    /** The fee the case keeps now (its newest assessment), or null for a case without one. */
    async forCase(tx: Tx, caseId: string): Promise<CaseFee | null> {
        const latest = await this.assessment(tx, caseId, 'latest');
        return latest ? this.out(tx, latest) : null;
    }

    private async assessment(tx: Tx, caseId: string, which: 'first' | 'latest'): Promise<CaseFeeRow | undefined> {
        const [row] = await tx
            .select()
            .from(caseFees)
            .where(eq(caseFees.caseId, caseId))
            .orderBy(which === 'first' ? asc(caseFees.number) : desc(caseFees.number))
            .limit(1);
        return row;
    }

    private async keep(
        tx: Tx,
        target: { caseId: string; regionId: string; handlingUnitId: string; submissionId: string | null },
        rule: ApprovedFeeRule,
        inputMap: Record<string, string>,
        asOf: string,
        reason: 'filed' | 'amended',
        number: number,
        result: Extract<FeeResult, { status: 'complete' }>
    ): Promise<CaseFee> {
        const row = await insertAudited(tx, caseFees, {
            regionId: target.regionId,
            handlingUnitId: target.handlingUnitId,
            caseId: target.caseId,
            number,
            reason,
            feeRuleVersionId: rule.versionId,
            inputMap,
            asOf,
            submissionId: target.submissionId,
            totalSantim: result.total,
            demo: rule.demo
        });
        let position = 0;
        for (const line of result.lines)
            await insertAudited(tx, caseFeeLines, {
                regionId: target.regionId,
                handlingUnitId: target.handlingUnitId,
                caseFeeId: row.id,
                position: ++position,
                key: line.key,
                label: line.label,
                quantity: line.quantity,
                amountSantim: line.amount
            });
        return this.out(tx, row);
    }

    private async out(tx: Tx, row: CaseFeeRow): Promise<CaseFee> {
        const lines = await tx
            .select()
            .from(caseFeeLines)
            .where(eq(caseFeeLines.caseFeeId, row.id))
            .orderBy(asc(caseFeeLines.position));
        return {
            id: row.id,
            caseId: row.caseId,
            number: row.number,
            reason: row.reason,
            feeRuleVersionId: row.feeRuleVersionId,
            asOf: row.asOf,
            demo: row.demo,
            lines: lines.map((l) => ({
                key: l.key,
                label: l.label,
                quantity: l.quantity,
                amountSantim: santimText(l.amountSantim)
            })),
            totalSantim: santimText(row.totalSantim),
            computedAt: row.createdAt.toISOString()
        };
    }
}
