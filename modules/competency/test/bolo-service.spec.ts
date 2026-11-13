/**
 * The bolo (task 1.3a, DVC-02): its workflow, its forms and checklist as the engine reads them, its fee rule on the zone's table,
 * and the validity rule. A failed item blocks the pass (the server's checklist outcome, task 1.13a). A failed vehicle goes to a garage
 * and comes back to re-inspection on the same case; the owners' reminder falls due before the last day (task 1.3b).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocument, checklistOf, evaluateFee, readDocument, submittedValues } from '@itrms/form-engine/core';
import { parseFeeRules } from '@itrms/fees/seed';
import { workflowDefinitionSchema } from '@itrms/schemas';
import { describe, expect, it } from 'vitest';

import { boloValidity, daysAfter, reminderDue, reminderText } from '../api/bolo-validity';
import { BOLO_EFFECTS as B } from '../contracts';
import {
    BOLO_INSPECTION_FORM,
    BOLO_REPAIR_FORM,
    BOLO_REQUEST_FORM,
    BOLO_STICKER_FORM,
    boloFlow
} from '../seed/bolo-service';

interface Step {
    from: string | readonly string[];
    to: string;
    action?: string;
    on?: string;
    guard?: unknown;
    effects?: readonly string[];
    commentRequired?: boolean;
}

const flow = boloFlow('vehicle-bolo-inspection@1', 'vehicle-bolo-sticker@1', 'vehicle-bolo-repair@1');
const steps = flow.transitions as readonly Step[];
const PAID = { fact: 'payment.settled', op: 'eq', value: true };
const HERE = dirname(fileURLToPath(import.meta.url));

describe('the bolo workflow', () => {
    it('is a valid definition', () => {
        expect(workflowDefinitionSchema.safeParse(flow).success).toBe(true);
    });

    it('checks the request when it is filed and when it is corrected', () => {
        const filing = steps.filter((t) => t.from === 'draft' && t.to === 'review');
        expect(filing.map((t) => t.action).sort()).toEqual(['correct', 'submit']);
        for (const t of filing) expect(t.effects).toContain(B.checkBolo);
    });

    it('inspects only after payment: a pass makes the bolo, a fail sends the vehicle to a garage', () => {
        expect(steps.find((t) => t.from === 'payment' && t.on === 'event:payment.settled')?.to).toBe('inspection');
        expect(steps.find((t) => t.action === 'pass')).toMatchObject({
            from: 'inspection',
            to: 'sticker',
            guard: PAID,
            effects: [`${B.recordBoloInspection}:pass`]
        });
        expect(steps.find((t) => t.action === 'fail')).toMatchObject({
            from: 'inspection',
            to: 'repair',
            effects: [`${B.recordBoloInspection}:fail`]
        });
    });

    it('brings a repaired vehicle back to inspection on the same case and fee, or closes it as failed', () => {
        expect(steps.find((t) => t.action === 'reinspect')).toMatchObject({
            from: 'repair',
            to: 'inspection',
            guard: PAID,
            effects: [B.recordBoloRepair]
        });
        expect(steps.find((t) => t.action === 'close_failed')).toMatchObject({
            from: 'repair',
            to: 'failed',
            commentRequired: true
        });
        // no second payment: the only way into payment is the first approval
        expect(steps.filter((t) => t.to === 'payment').map((t) => t.from)).toEqual(['review']);
        const repair = flow.states.find((s) => s.key === 'repair') as { stepForm?: string; sla?: unknown } | undefined;
        expect(repair).toMatchObject({ stepForm: 'vehicle-bolo-repair@1', sla: { businessDays: 30 } });
    });

    it('gives the sticker, or a temporary bolo first and the sticker later, on the same case', () => {
        expect(steps.find((t) => t.action === 'issue_sticker')).toMatchObject({
            from: ['sticker', 'temporary'],
            to: 'issued',
            effects: [B.issueBoloSticker]
        });
        expect(steps.find((t) => t.action === 'issue_temporary')).toMatchObject({
            from: 'sticker',
            to: 'temporary',
            effects: [B.issueTemporaryBolo]
        });
        const state = (key: string) => flow.states.find((s) => s.key === key) as { stepForm?: string } | undefined;
        expect(state('inspection')?.stepForm).toBe('vehicle-bolo-inspection@1');
        expect(state('sticker')?.stepForm).toBe('vehicle-bolo-sticker@1');
    });
});

describe('the bolo forms', () => {
    it('are forms the engine takes, the inspection on the Checklist type with critical items', () => {
        for (const form of [BOLO_REQUEST_FORM, BOLO_INSPECTION_FORM, BOLO_STICKER_FORM, BOLO_REPAIR_FORM])
            expect(checkDocument(form)).toEqual([]);
        const inspection = readDocument(BOLO_INSPECTION_FORM, { language: 'en' }).fields.find(
            (f) => f.id === 'inspection'
        );
        const def = inspection && checklistOf(inspection);
        expect(def?.scoring).toBe('passFail');
        expect(def?.sections.flatMap((s) => s.items).length).toBeGreaterThanOrEqual(20);
        expect(
            def?.sections
                .flatMap((s) => s.items)
                .filter((i) => i.critical)
                .map((i) => i.key)
        ).toEqual(expect.arrayContaining(['serviceBrake', 'parkingBrake', 'steering', 'chassis']));
    });

    it('blocks the pass on any failed item: the stored outcome is the server\x27s', () => {
        const fields = readDocument(BOLO_INSPECTION_FORM).fields;
        const inspection = fields.find((f) => f.id === 'inspection');
        const def = inspection && checklistOf(inspection);
        if (!def) throw new Error('no checklist');
        const items = Object.fromEntries(def.sections.flatMap((s) => s.items).map((i) => [i.key, { result: 'pass' }]));
        const passed = submittedValues(fields, { inspection: { items } }) as { inspection: { outcome: unknown } };
        expect(passed.inspection.outcome).toMatchObject({ passed: true });
        const failed = submittedValues(fields, {
            inspection: {
                items: { ...items, headlights: { result: 'fail', remark: 'Left lamp out' } },
                outcome: { passed: true }
            }
        }) as { inspection: { outcome: unknown } };
        expect(failed.inspection.outcome).toMatchObject({ passed: false, failed: ['headlights'] });
    });
});

describe('the bolo fee (the zone\x27s table, Q12.5)', () => {
    const rules = parseFeeRules(readFileSync(join(HERE, '..', 'seed', 'fee-rules.demo.yaml'), 'utf8'));
    const rule = rules.find((r) => r.key === 'dvc-02-bolo');
    const fee = (answers: Record<string, unknown>) => {
        if (!rule) throw new Error('no rule');
        const result = evaluateFee(rule.document, { answers, asOf: '2026-11-13' });
        return result.status === 'complete' ? String(result.total) : `error: ${JSON.stringify(result)}`;
    };

    it('is 1,000 Birr for a car or a motorcycle, by seats for a bus and by load for a truck, 1,500 for the rest', () => {
        expect(fee({ use: 'private' })).toBe('100000');
        expect(fee({ use: 'public_transport', seats: 5 })).toBe('100000');
        expect(fee({ use: 'public_transport', seats: 30 })).toBe('150000');
        expect(fee({ use: 'public_transport', seats: 60 })).toBe('200000');
        expect(fee({ use: 'commercial', loadTonnes: 10 })).toBe('100000');
        expect(fee({ use: 'commercial', loadTonnes: 20 })).toBe('150000');
        expect(fee({ use: 'commercial', loadTonnes: 50 })).toBe('200000');
        expect(fee({ use: 'government' })).toBe('150000');
        expect(fee({ use: 'police' })).toBe('150000');
    });
});

describe('a bolo\x27s validity', () => {
    it('runs to Sene 30 of the fiscal year the vehicle was inspected in', () => {
        // 13 November 2026 is in EFY 2019, which ends on Sene 30, 2019 (7 July 2027)
        expect(boloValidity('2026-11-13')).toEqual({ fiscalYear: 2019, validUntil: '2027-07-07' });
        // Hamle 1, 2018 (8 July 2026) opens EFY 2019; the day before is the last of EFY 2018
        expect(boloValidity('2026-07-08').fiscalYear).toBe(2019);
        expect(boloValidity('2026-07-07')).toEqual({ fiscalYear: 2018, validUntil: '2026-07-07' });
    });

    it('counts a temporary bolo\x27s days from a day', () => {
        expect(daysAfter('2026-11-13', 30)).toBe('2026-12-13');
        expect(daysAfter('2026-12-20', 30)).toBe('2027-01-19');
    });
});

describe('the renewal reminder', () => {
    it('falls due a number of days before the last day, at 08:00 in Addis Ababa', () => {
        expect(reminderDue('2027-07-07', 30).toISOString()).toBe('2027-06-07T05:00:00.000Z');
        expect(reminderDue('2027-03-01', 1).toISOString()).toBe('2027-02-28T05:00:00.000Z');
    });

    it('names the plate and the last day in the Ethiopian calendar', () => {
        const text = reminderText('ETH ABC 1234', '2027-07-07');
        expect(text).toContain('ETH ABC 1234');
        expect(text).toContain('ሰኔ 30');
        expect(text).toContain('2019');
    });
});
