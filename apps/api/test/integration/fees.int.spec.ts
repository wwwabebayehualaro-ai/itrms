/**
 * Fees, part 1 (task 0.22a, ADR-0041), on a real PostgreSQL 16: a fee rule's versions are decided by another person in a
 * role the region names; a service version charges only by an approved rule of the region's own, whose inputs the request
 * form holds (never a Sensitive one), and whose workflow works the fee out again on every correction. The preview at the
 * counter equals the fee the case keeps when the request is filed (lines and total in santim); a figure that changed
 * since it was shown refuses the filing; a correction that changes the fee adds an assessment, one that does not, none.
 * The preview stores nothing; every write is audited; another office never sees a case's fee.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c301',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301'
};
const SERVICE = 'RS-05';

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const t = (en: string) => ({ am: en, en });

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: t(id),
    classification: 'personal',
    props: extra.required ? { required: true } : {},
    behavior: { validation: { supported: true } },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'required'))
});
const FORM = {
    schemaVersion: 2,
    fields: [
        field('plate', 'InputText', { required: true }),
        field('grade', 'Dropdown', {
            required: true,
            data: {
                dataSource: {
                    staticData: [
                        { label: t('Automobile'), value: 'auto' },
                        { label: t('Public 1'), value: 'public-1' }
                    ]
                }
            }
        }),
        field('expiry', 'Calendar', { required: true }),
        field('lost', 'InputSwitch'),
        field('idNo', 'InputText', { classification: 'sensitive' }),
        { id: 'fee', type: 'Fee', category: 'Data', label: t('Fee'), props: { showLines: true } }
    ]
};
const RULE = {
    schemaVersion: 1,
    inputs: { grade: { kind: 'choice' }, expiry: { kind: 'date' }, lost: { kind: 'boolean', required: false } },
    lines: [
        {
            key: 'base',
            label: t('Renewal'),
            kind: 'table',
            input: 'grade',
            rows: [
                { value: 'auto', amount: '30000' },
                { value: 'public-1', amount: '45000' }
            ]
        },
        {
            key: 'penalty',
            label: t('Late, per started month'),
            kind: 'perUnit',
            amount: '5000',
            quantity: 'startedMonths(input.expiry, asOf)',
            maxUnits: 24,
            when: 'days(input.expiry, asOf) > 0'
        },
        { key: 'card', label: t('Replacement card'), kind: 'fixed', amount: '15000', when: 'input.lost' }
    ],
    demo: true
};

/** A day `n` days before today in Addis Ababa. */
const daysAgo = (n: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date(Date.now() - n * 86_400_000));

const workflowOf = (effects: string[]) => ({
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        { key: 'check', kind: 'task', label: t('Check'), assignee: { role: 'unit_head', unit: 'handling' } },
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'check', action: 'submit' },
        {
            from: 'check',
            to: 'check',
            action: 'correct',
            label: t('Correct'),
            amendsRequest: true,
            commentRequired: true,
            effects
        },
        { from: 'check', to: 'done', action: 'approve' }
    ]
});

let formVersionId = '';
let workflowVersionId = '';
let ruleId = '';
let approvedVersionId = '';

async function publishedForm(key: string, document: object): Promise<string> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, { key, name: t(key), document });
    expect(created.statusCode, created.body).toBe(201);
    const asked = await api.call(
        'POST',
        `/api/v1/forms/${created.json<{ id: string }>().id}/publications`,
        as.bureau,
        {}
    );
    expect(asked.statusCode, asked.body).toBe(201);
    const publication = asked.json<{ id: string; version: number; formVersion: { id: string } }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${publication.id}/approval`,
        as.bureau2,
        {},
        ifMatch(publication.version)
    );
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    return publication.formVersion.id;
}

async function workflow(key: string, effects: string[]): Promise<string> {
    const res = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key,
        name: t(key),
        definition: workflowOf(effects)
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ latestVersion: { id: string } }>().latestVersion.id;
}

const publish = (body: object) => api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, body);
const preview = (answers: object, who: As = as.damotRecords) =>
    api.call('POST', '/api/v1/fees/preview', who, { serviceCode: SERVICE, answers });
const countOf = async (sql: string, params: unknown[] = []) =>
    (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.bureau.fourth',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        }
    ]);
    const region = await api.unit('SER', 'SER');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.boditiHead = { sub: SUB.boditiHead, unit: await api.unit('SER', 'WOL-BODITI') };
    formVersionId = await publishedForm('renewal-request', FORM);
    workflowVersionId = await workflow('renewal-check', ['fees.assess']);
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('a fee rule', () => {
    it('is written at the region root and decided once by another person, in a role the region names', async () => {
        const created = await api.call('POST', '/api/v1/fee-rules', as.bureau, {
            key: 'renewal',
            name: t('Licence renewal'),
            document: RULE
        });
        expect(created.statusCode, created.body).toBe(201);
        const rule = created.json<{ id: string; latestVersion: { id: string; status: string; number: number } }>();
        ruleId = rule.id;
        expect(rule.latestVersion).toMatchObject({ number: 1, status: 'pending' });
        const versionId = rule.latestVersion.id;
        const decide = (who: As, decision = 'approved') =>
            api.call('POST', `/api/v1/fee-rules/${ruleId}/versions/${versionId}/approval`, who, { decision });

        // not by an office below, nor by its author (refused on record), nor by a role without the right
        expect(
            (await api.call('POST', '/api/v1/fee-rules', as.damotHead, { key: 'x-y', name: t('X'), document: RULE }))
                .statusCode
        ).toBe(403);
        expect((await decide(as.bureau)).statusCode).toBe(403);
        expect(
            await countOf(
                `select count(*)::int as n from kernel.audit_log where event_type = 'access.denied' and diff ->> 'reason' = 'fee_rule_self_approval'`
            )
        ).toBe(1);
        expect((await decide(as.damotRecords)).statusCode).toBe(403);

        // a rule reading a case's fact cannot be worked out yet (a new case has none): refused
        const fact = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: {
                ...RULE,
                inputs: { ...RULE.inputs, age: { kind: 'number', from: 'fact', fact: 'vehicle.age' } }
            }
        });
        expect(fact.statusCode).toBe(422);
        expect(fact.json()).toMatchObject({ errors: [{ path: 'document.inputs.age.from', code: 'fact_input' }] });

        // a formula reading what is not the rule's is refused before anything is stored
        const bad = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: { ...RULE, lines: [{ ...RULE.lines[2], when: 'form.secret' }] }
        });
        expect(bad.statusCode).toBe(422);
        expect(bad.json()).toMatchObject({ errors: [{ path: 'document.lines.0.when', code: 'unknown_reference' }] });

        const approved = await decide(as.bureau2);
        expect(approved.statusCode, approved.body).toBe(201);
        expect(approved.json()).toMatchObject({ status: 'approved', decidedBy: await api.userId(SUB.bureau2) });
        expect((await decide(as.bureau2, 'rejected')).statusCode).toBe(409);
        approvedVersionId = versionId;

        // the region names who decides: with only its finance officers, a bureau administrator may not
        const setting = await api.call(
            'PUT',
            `/api/v1/org-units/${as.bureau.unit.id}/settings/fees.rules.approverRoles`,
            as.bureau,
            { value: ['finance_officer'] },
            ifMatch(0)
        );
        expect(setting.statusCode, setting.body).toBe(200);
        const second = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: { ...RULE, basis: 'version two' }
        });
        expect(second.statusCode, second.body).toBe(201);
        const secondId = second.json<{ id: string }>().id;
        const refused = await api.call(
            'POST',
            `/api/v1/fee-rules/${ruleId}/versions/${secondId}/approval`,
            as.bureau2,
            { decision: 'approved' }
        );
        expect(refused.statusCode).toBe(403);
        const back = await api.call(
            'PUT',
            `/api/v1/org-units/${as.bureau.unit.id}/settings/fees.rules.approverRoles`,
            as.bureau,
            { value: ['bureau_admin', 'finance_officer'] },
            ifMatch(setting.json<{ version: number }>().version)
        );
        expect(back.statusCode, back.body).toBe(200);

        // content rejected is not proposed again as it was
        const third = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: { ...RULE, basis: 'rejected' }
        });
        const thirdId = third.json<{ id: string }>().id;
        expect(
            (
                await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions/${thirdId}/approval`, as.bureau2, {
                    decision: 'rejected',
                    reason: 'wrong amounts'
                })
            ).statusCode
        ).toBe(201);
        const again = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: { ...RULE, basis: 'rejected' }
        });
        expect(again.statusCode).toBe(422);
        expect(again.json()).toMatchObject({ errors: [{ path: 'document', code: 'fee_rule_rejected' }] });

        // every write on record, a version's content never in it
        const audit = await api.owner.query<{ table_name: string; diff: Record<string, unknown> }>(
            `select table_name, diff from kernel.audit_log where table_name like 'fees.%' order by at, id`
        );
        expect(audit.rows.map((r) => r.table_name)).toEqual(
            expect.arrayContaining(['fees.fee_rules', 'fees.fee_rule_versions', 'fees.fee_rule_approvals'])
        );
        expect(
            audit.rows.filter((r) => r.table_name === 'fees.fee_rule_versions').every((r) => !('document' in r.diff))
        ).toBe(true);
    });

    it('is charged by only when approved, its inputs on the form (never Sensitive) and worked out again on corrections', async () => {
        const base = { formVersionId, workflowVersionId, overridePolicy: {} };
        const pending = await api.call('POST', `/api/v1/fee-rules/${ruleId}/versions`, as.bureau, {
            document: { ...RULE, basis: 'pending' }
        });
        const pendingId = pending.json<{ id: string }>().id;
        const problems = async (body: object) => {
            const res = await publish(body);
            expect(res.statusCode, res.body).toBe(422);
            return res.json<{ errors: { path: string; code: string }[] }>().errors.map((e) => e.code);
        };
        expect(await problems({ ...base, feeRuleVersionId: pendingId })).toContain('fee_rule_not_approved');
        expect(await problems({ ...base, feeRuleVersionId: null })).toContain('fee_field_without_rule');
        expect(
            await problems({
                ...base,
                feeRuleVersionId: approvedVersionId,
                inputMap: { 'fees.rule': { lost: 'idNo' } }
            })
        ).toContain('fee_input_sensitive');
        expect(
            await problems({
                ...base,
                feeRuleVersionId: approvedVersionId,
                inputMap: { 'fees.rule': { grade: 'plate' } }
            })
        ).toContain('contract_wrong_kind');
        // an optional input a condition can hide: the preview, reading the inputs alone, would not see what files
        const conditional = await publishedForm('renewal-conditional', {
            ...FORM,
            fields: [
                ...FORM.fields.filter((f) => f.id !== 'lost'),
                field('reason', 'InputText'),
                field('lost', 'InputSwitch', {
                    behavior: {
                        validation: { supported: true },
                        visibilityConditions: [{ field: 'reason', operator: 'eq', value: 'lost' }]
                    }
                })
            ]
        });
        expect(await problems({ ...base, formVersionId: conditional, feeRuleVersionId: approvedVersionId })).toContain(
            'contract_conditional'
        );
        // Sensitive through the section it sits in
        const hidden = await publishedForm('renewal-sensitive-section', {
            ...FORM,
            fields: [
                ...FORM.fields.map((f) => (f.id === 'grade' ? { ...f, parentId: 'private' } : f)),
                {
                    id: 'private',
                    type: 'Panel',
                    label: t('Private'),
                    classification: 'sensitive',
                    props: {},
                    layout: { options: { isContainer: true } }
                }
            ]
        });
        expect(await problems({ ...base, formVersionId: hidden, feeRuleVersionId: approvedVersionId })).toContain(
            'fee_input_sensitive'
        );
        // the counter must see the fee it files
        const silent = await publishedForm('renewal-no-fee-field', {
            ...FORM,
            fields: FORM.fields.filter((f) => f.type !== 'Fee')
        });
        expect(await problems({ ...base, formVersionId: silent, feeRuleVersionId: approvedVersionId })).toContain(
            'fee_field_missing'
        );
        const unchecked = await workflow('renewal-unchecked', []);
        expect(
            await problems({ ...base, workflowVersionId: unchecked, feeRuleVersionId: approvedVersionId })
        ).toContain('fee_not_reassessed');

        const published = await publish({ ...base, feeRuleVersionId: approvedVersionId });
        expect(published.statusCode, published.body).toBe(201);
        expect(published.json()).toMatchObject({ version: { feeRuleVersionId: approvedVersionId } });
    });
});

describe('the demo fee rules', () => {
    it('are seeded at the region root, approved as an installation step, once', async () => {
        const file = join(
            dirname(fileURLToPath(import.meta.url)),
            '..',
            '..',
            '..',
            '..',
            'modules',
            'competency',
            'seed',
            'fee-rules.demo.yaml'
        );
        const rules = parseFeeRules(readFileSync(file, 'utf8'));
        const root = as.bureau.unit;
        const seed = () =>
            api.installer.scoped({}, (tx) => importFeeRules(tx, { id: root.id, regionId: root.regionId }, rules));
        expect(await seed()).toBe(3);
        expect(await seed()).toBe(0);
        // a real schedule waits for a person's decision
        const real = rules.map((r) =>
            r.key === 'dvc-06-replacement' ? { ...r, document: { ...r.document, demo: false, basis: 'schedule' } } : r
        );
        expect(
            await api.installer.scoped({}, (tx) => importFeeRules(tx, { id: root.id, regionId: root.regionId }, real))
        ).toBe(1);
        const pending = await api.owner.query(
            `select 1 from fees.fee_rules r left join fees.fee_rule_approvals a on a.version_id = r.latest_version_id
              where r.key = 'dvc-06-replacement' and a.id is null`
        );
        expect(pending.rowCount).toBe(1);
        // back to the demo version for what follows
        expect(await seed()).toBe(0);
        const { rows } = await api.owner.query<{ key: string; decision: string; decided_by: string | null }>(
            `select r.key, a.decision, a.decided_by from fees.fee_rules r
               join fees.fee_rule_approvals a on a.version_id = r.latest_version_id
              where r.key like 'dvc-%' order by r.key`
        );
        expect(rows).toEqual([
            { key: 'dvc-03-new-licence', decision: 'approved', decided_by: null },
            { key: 'dvc-04-renewal', decision: 'approved', decided_by: null },
            { key: 'dvc-06-replacement', decision: 'approved', decided_by: null }
        ]);
    });
});

describe('a request', () => {
    const answers = { plate: 'ETH ABC 0042', grade: 'auto', expiry: daysAgo(40) };

    it('is filed with the fee its preview showed: the case keeps the same lines and total, the preview stores nothing', async () => {
        const auditBefore = await countOf('select count(*)::int as n from kernel.audit_log');
        const keysBefore = await countOf('select count(*)::int as n from kernel.idempotency_keys');
        const shown = await preview(answers);
        expect(shown.statusCode, shown.body).toBe(200);
        const fee = shown.json<{
            status: string;
            totalSantim: string;
            feeRuleVersionId: string;
            lines: { key: string; quantity: number | null; amountSantim: string }[];
            inputKeys: string[];
            demo: boolean;
        }>();
        // 40 days late: two started months
        expect(fee).toMatchObject({
            status: 'complete',
            demo: true,
            totalSantim: '40000',
            inputKeys: ['expiry', 'grade', 'lost'],
            lines: [
                { key: 'base', quantity: null, amountSantim: '30000' },
                { key: 'penalty', quantity: 2, amountSantim: '10000' }
            ]
        });
        expect(await countOf('select count(*)::int as n from kernel.audit_log')).toBe(auditBefore);
        expect(await countOf('select count(*)::int as n from kernel.idempotency_keys')).toBe(keysBefore);

        // what is not answered yet is named; a value sent for the Fee field is no answer
        expect((await preview({ plate: 'X', grade: 'auto', fee: '1' })).json()).toMatchObject({
            status: 'incomplete',
            missing: ['expiry']
        });

        const filed = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers: { ...answers, fee: '999' },
            fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
        });
        expect(filed.statusCode, filed.body).toBe(201);
        const c = filed.json<CaseOut>();
        const kept = await api.call('GET', `/api/v1/cases/${c.id}/fee`, as.damotRecords);
        expect(kept.statusCode, kept.body).toBe(200);
        expect(kept.json()).toMatchObject({
            number: 1,
            reason: 'filed',
            feeRuleVersionId: fee.feeRuleVersionId,
            totalSantim: fee.totalSantim,
            lines: fee.lines
        });
        // a total the sum of its lines, in santim, in the typed tables
        const { rows } = await api.owner.query<{ total: string; sum: string; fee: unknown }>(
            `select f.total_santim::text as total, sum(l.amount_santim)::text as sum,
                    (select answers -> 'fee' from forms.submissions where case_id = f.case_id) as fee
               from fees.case_fees f join fees.case_fee_lines l on l.case_fee_id = f.id
              where f.case_id = $1 group by f.id`,
            [c.id]
        );
        expect(rows[0]).toEqual({ total: '40000', sum: '40000', fee: null });
        // on record, in the filing's transaction
        expect(
            await countOf(
                `select count(*)::int as n from kernel.audit_log where row_id in (
                    select id from fees.case_fees where case_id = $1
                    union all select l.id from fees.case_fee_lines l join fees.case_fees f on f.id = l.case_fee_id
                     where f.case_id = $1)`,
                [c.id]
            )
        ).toBe(3);

        // another office never sees it
        expect((await api.call('GET', `/api/v1/cases/${c.id}/fee`, as.boditiHead)).statusCode).toBe(404);
    });

    it('is refused when the fee changed since it was shown, and starts no case', async () => {
        const cases = await countOf('select count(*)::int as n from workflow.cases');
        const shown = (await preview(answers)).json<{ feeRuleVersionId: string }>();
        const stale = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers,
            fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: '35000' }
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({ code: 'fee_changed' });
        expect(await countOf('select count(*)::int as n from workflow.cases')).toBe(cases);
    });

    it('is refused when it sends no fee shown, as the counter always shows one', async () => {
        const cases = await countOf('select count(*)::int as n from workflow.cases');
        const unseen = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers
        });
        expect(unseen.statusCode).toBe(422);
        expect(unseen.json()).toMatchObject({ errors: [{ path: 'fee', code: 'fee_not_shown' }] });
        expect(await countOf('select count(*)::int as n from workflow.cases')).toBe(cases);
    });

    it('is assessed again when a correction changes its fee, and only then', async () => {
        const shown = (await preview(answers)).json<{ feeRuleVersionId: string; totalSantim: string }>();
        const filed = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers,
            fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
        });
        expect(filed.statusCode, filed.body).toBe(201);
        let c = filed.json<CaseOut>();
        const act = async (who: As, body: object) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        expect((await act(as.damotRecords, { action: 'submit' })).statusCode).toBe(200);
        const assessments = () =>
            api.owner.query<{ number: number; reason: string; total: string }>(
                'select number, reason, total_santim::text as total from fees.case_fees where case_id = $1 order by number',
                [c.id]
            );

        // the plate corrected: the fee stays as it was
        const plate = await act(as.damotHead, {
            action: 'correct',
            comment: 'misread',
            answers: { ...answers, plate: 'ETH ABC 0043' }
        });
        expect(plate.statusCode, plate.body).toBe(200);
        expect((await assessments()).rows).toEqual([{ number: 1, reason: 'filed', total: '40000' }]);

        // the grade corrected: a new assessment, counted to the filing day (the rule's default)
        const grade = await act(as.damotHead, {
            action: 'correct',
            comment: 'a public licence',
            answers: { ...answers, plate: 'ETH ABC 0043', grade: 'public-1' }
        });
        expect(grade.statusCode, grade.body).toBe(200);
        expect((await assessments()).rows).toEqual([
            { number: 1, reason: 'filed', total: '40000' },
            { number: 2, reason: 'amended', total: '55000' }
        ]);
        expect((await api.call('GET', `/api/v1/cases/${c.id}/fee`, as.damotHead)).json()).toMatchObject({
            number: 2,
            totalSantim: '55000'
        });
        // and a case's fees never change in place
        await expect(
            api.owner.query(`update fees.case_fees set total_santim = 1 where case_id = $1`, [c.id])
        ).rejects.toThrow(/append-only/);
    });
});
