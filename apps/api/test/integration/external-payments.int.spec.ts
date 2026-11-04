/**
 * Money paid elsewhere (task 0.22c, ADR-0043), on a real PostgreSQL 16. A reference entered at the counter settles nothing
 * until it is verified, by a person other than who entered it or by a statement's line on an exact match in the importer's
 * subtree. One real reference settles one case: per issuer, normalised reference and fiscal year, also when two come at
 * the same moment, and a deposit taken at a till as a slip can't be used again as a reference, nor the other way round.
 * A verified reference that proves wrong is revoked by a third person. Every write is audited; what was filed never changes.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { addisToday } from '@itrms/fees/api';
import { matchEntered, processStatement, type StatementDeps } from '@itrms/fees/api/worker';
import { importFeeRules } from '@itrms/fees/seed';
import { feeRuleSchema } from '@itrms/schemas';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { CasesService } from '@itrms/workflow/api';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c401',
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    // a licensing expert: reads the case, not its payment
    boditiOfficer: '0199f0a0-d000-7000-8000-000000000305',
    // Boditi's finance officer, who also works the counter: never decides a reference they entered
    counterFinance: '0199f0a0-d000-7000-8000-00000000c402',
    // another woreda's finance officer: their statements verify nothing of Boditi's
    damotFinance: '0199f0a0-d000-7000-8000-00000000c403'
};
/** a case guarded on its payment, and one that waits on it, both paid elsewhere; and one paid at the till */
const GUARDED = 'RS-04';
const WAITING = 'RS-05';
const AT_TILL = 'RS-06';

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let deps: StatementDeps;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const t = (en: string) => ({ am: en, en });
const today = () => addisToday();

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
        { id: 'fee', type: 'Fee', category: 'Data', label: t('Fee'), props: { showLines: true } }
    ]
};
const RULE = {
    schemaVersion: 1 as const,
    demo: true,
    inputs: { grade: { kind: 'choice' as const } },
    lines: [
        {
            key: 'base',
            label: t('Licence'),
            kind: 'table' as const,
            input: 'grade',
            rows: [
                { value: 'auto', amount: '30000' },
                { value: 'public-1', amount: '45000' }
            ]
        },
        { key: 'card', label: t('Card'), kind: 'fixed' as const, amount: '10000' }
    ]
};
const reviewer = { key: 'review', kind: 'task', label: t('Review'), assignee: { role: 'unit_head', unit: 'handling' } };
const GUARDED_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        reviewer,
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: ['fees.createPaymentOrder'] },
        {
            from: 'review',
            to: 'review',
            action: 'correct',
            label: t('Correct'),
            amendsRequest: true,
            commentRequired: true,
            effects: ['fees.assess']
        },
        { from: 'review', to: 'done', action: 'approve', guard: { fact: 'payment.settled', op: 'eq', value: true } }
    ]
};
const WAITING_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        { key: 'payment', kind: 'wait', label: t('Payment') },
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'payment', action: 'submit', effects: ['fees.createPaymentOrder'] },
        {
            from: 'payment',
            to: 'done',
            on: 'event:payment.settled',
            actor: 'system:fees',
            guard: { fact: 'payment.settled', op: 'eq', value: true }
        }
    ]
};

async function publishedForm(key: string, document: object): Promise<string> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, { key, name: t(key), document });
    expect(created.statusCode, created.body).toBe(201);
    const asked = await api.call(
        'POST',
        `/api/v1/forms/${created.json<{ id: string }>().id}/publications`,
        as.bureau,
        {}
    );
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

async function publishService(
    code: string,
    key: string,
    definition: object,
    formVersionId: string,
    rule: string,
    defaults: Record<string, unknown>
) {
    const wf = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, { key, name: t(key), definition });
    expect(wf.statusCode, wf.body).toBe(201);
    const published = await api.call('POST', `/api/v1/services/${code}/versions`, as.bureau, {
        workflowVersionId: wf.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId,
        feeRuleVersionId: rule,
        defaults,
        overridePolicy: {}
    });
    expect(published.statusCode, published.body).toBe(201);
}

async function filed(code: string, grade = 'auto'): Promise<CaseOut> {
    const answers = { plate: `ETH ABC ${String(randomInt(1000, 10_000))}`, grade };
    const shown = (
        await api.call('POST', '/api/v1/fees/preview', as.boditiRecords, { serviceCode: code, answers })
    ).json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.boditiRecords, {
        serviceCode: code,
        answers,
        fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
    });
    expect(started.statusCode, started.body).toBe(201);
    const c = started.json<CaseOut>();
    const submitted = await api.call(
        'POST',
        `/api/v1/cases/${c.id}/transitions`,
        as.boditiRecords,
        { action: 'submit' },
        ifMatch(c.version)
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    return submitted.json<CaseOut>();
}

interface Ref {
    id: string;
    state: string;
    issuer: string;
    reference: string;
    fiscalYear: number;
    verifiedVia: string | null;
    rejectedBefore: number;
    paidBeforeOrder: boolean;
    statement: { state: string; amountSantim: string | null } | null;
}
interface Order {
    id: string;
    caseId: string;
    state: string;
    collection: string;
    totalSantim: string;
    externalRefs: Ref[];
}
const orderOf = async (caseId: string, who: As = as.boditiRecords) => {
    const res = await api.call('GET', `/api/v1/cases/${caseId}/payment`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Order>();
};
let serial = 0;
/** A reference no other test uses. */
const fresh = (prefix = 'FT') => `${prefix}${String(Date.now() % 1_000_000)}${String((serial += 1))}`;
const enter = (orderId: string, body: object = {}, who: As = as.boditiRecords) =>
    api.call(
        'POST',
        `/api/v1/payment-orders/${orderId}/external-refs`,
        who,
        {
            issuer: 'REVENUE',
            reference: fresh(),
            amountSantim: '40000',
            paidOn: today(),
            receivedFrom: 'Generated Applicant',
            ...body
        },
        { 'idempotency-key': randomUUID() }
    );
const decide = (id: string, who: As, decision = 'verified', note?: string) =>
    api.call('POST', `/api/v1/external-payment-refs/${id}/decision`, who, { decision, ...(note ? { note } : {}) });
const revoke = (id: string, who: As, reason = 'it was entered on the wrong case') =>
    api.call('POST', `/api/v1/external-payment-refs/${id}/revocation`, who, { reason });
const factsOf = async (id: string) =>
    (await api.owner.query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))
        .rows[0]?.facts;
const caseOf = async (id: string, who: As = as.boditiHead) =>
    (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();
const count = async (sql: string, params: unknown[] = []) =>
    (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

/** A statement imported (through the API) and read by the worker's code: its id. */
async function imported(rows: string[], who: As = as.zoneFinance, issuer = 'REVENUE'): Promise<string> {
    const res = await api.call(
        'POST',
        '/api/v1/external-statements',
        who,
        {
            issuer,
            statementDate: today(),
            filename: 'statement.csv',
            content: ['reference,amount,date', ...rows, `# ${randomUUID()},1,2000-01-01`].join('\n')
        },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json<{ id: string }>().id;
    await processStatement(system, deps, id);
    return id;
}
interface Line {
    lineNo: number;
    reference: string | null;
    state: string;
    reason: string | null;
}
const linesOf = async (id: string, who: As = as.zoneFinance) =>
    (await api.call('GET', `/api/v1/external-statements/${id}/lines?all=true`, who)).json<{ items: Line[] }>().items;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.bureau.other',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        },
        {
            username: 'test.boditi.counterfinance',
            sub: SUB.counterFinance,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'records_officer'],
                ['WOL-BODITI', 'finance_officer']
            ]
        },
        {
            username: 'test.damot.finance',
            sub: SUB.damotFinance,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'finance_officer']]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    deps = { cases: api.http.get(CasesService) };
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.zoneFinance = { sub: SUB.zoneFinance, unit: zone };
    as.boditiHead = { sub: SUB.boditiHead, unit: boditi };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.boditiOfficer = { sub: SUB.boditiOfficer, unit: boditi };
    as.counterFinance = { sub: SUB.counterFinance, unit: boditi };
    as.damotFinance = { sub: SUB.damotFinance, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

    await api.installer.scoped({}, (tx) =>
        importFeeRules(tx, { id: region.id, regionId: region.regionId }, [
            { key: 'licence-demo', name: t('Licence (demo)'), document: feeRuleSchema.parse(RULE) }
        ])
    );
    const { rows } = await api.owner.query<{ id: string }>(
        `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id
          where r.key = 'licence-demo'`
    );
    const rule = rows[0]?.id ?? '';
    const form = await publishedForm('licence-request', FORM);
    const elsewhere = { 'payment.collection': 'elsewhere' };
    await publishService(GUARDED, 'paid-elsewhere-guarded', GUARDED_FLOW, form, rule, elsewhere);
    await publishService(WAITING, 'paid-elsewhere-waiting', WAITING_FLOW, form, rule, elsewhere);
    await publishService(AT_TILL, 'paid-at-till', GUARDED_FLOW, form, rule, {});
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('a reference entered at the counter', () => {
    it('is the whole total, from an issuer the region names, at the case office, of an order paid elsewhere', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        expect(order).toMatchObject({ state: 'open', collection: 'elsewhere', totalSantim: '40000' });

        const wrongAmount = await enter(order.id, { amountSantim: '39999' });
        expect(wrongAmount.json()).toMatchObject({ code: 'amount_mismatch' });
        expect((await enter(order.id, { issuer: 'NOBODY' })).statusCode).toBe(422);
        expect((await enter(order.id, { reference: '---' })).statusCode).toBe(422);
        expect((await enter(order.id, { paidOn: '2999-01-01' })).statusCode).toBe(422);
        // the zone's finance officer has no right to enter one; the licensing expert neither
        expect((await enter(order.id, {}, as.zoneFinance)).statusCode).toBe(403);
        expect((await enter(order.id, {}, as.boditiOfficer)).statusCode).toBe(403);
        expect(
            await count('select count(*)::int as n from fees.external_payment_refs where order_id = $1', [order.id])
        ).toBe(0);

        // an order paid at the till takes no reference; one paid elsewhere takes no payment at the till
        const atTill = await orderOf((await filed(AT_TILL)).id);
        expect((await enter(atTill.id)).statusCode).toBe(409);
        const paidHere = await api.call(
            'POST',
            `/api/v1/payment-orders/${order.id}/payments`,
            as.boditiCashier,
            { method: 'cash', amountSantim: '40000', receivedFrom: 'Generated Applicant' },
            { 'idempotency-key': randomUUID() }
        );
        expect(paidHere.statusCode).toBe(409);
    });

    it('settles nothing until it is verified: one waits at a time, and the case stays', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const entered = await enter(order.id);
        expect(entered.statusCode, entered.body).toBe(201);
        expect(entered.json()).toMatchObject({ state: 'pending_verification', issuer: 'REVENUE' });

        expect((await orderOf(c.id)).state).toBe('open');
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: false, collection: 'elsewhere' } });
        const kase = await caseOf(c.id);
        const approve = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'approve' },
            ifMatch(kase.version)
        );
        expect(approve.statusCode).toBe(409);
        expect((await enter(order.id)).statusCode).toBe(409);
        expect(kase.events.filter((e) => e.kind === 'payment').map((e) => e.action)).toEqual(['reference_entered']);
    });

    it('settles one case, once: per issuer, reference and fiscal year, also at the same moment', async () => {
        const [a, b] = await Promise.all([orderOf((await filed(GUARDED)).id), orderOf((await filed(GUARDED)).id)]);
        const reference = fresh();
        const results = await Promise.all([enter(a.id, { reference }), enter(b.id, { reference })]);
        expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
        expect(results.find((r) => r.statusCode === 409)?.json()).toMatchObject({ code: 'duplicate_reference' });

        const other = await orderOf((await filed(GUARDED)).id);
        // punctuation, case and leading zeros do not make it another reference
        const zeros = fresh('77');
        expect((await enter(other.id, { reference: zeros })).statusCode).toBe(201);
        const again = await orderOf((await filed(GUARDED)).id);
        const padded = await enter(again.id, { reference: `00-${zeros.slice(0, 3)} ${zeros.slice(3)}` });
        expect(padded.json()).toMatchObject({ code: 'duplicate_reference' });
        // another issuer's number is another reference, and so is the same number in another fiscal year
        expect((await enter(again.id, { reference: zeros, issuer: 'CBE' })).statusCode).toBe(201);
        const lastYear = await orderOf((await filed(GUARDED)).id);
        await api.owner.query(
            `insert into fees.external_payment_refs (id, region_id, handling_unit_id, order_id, case_id, issuer, reference,
                    reference_norm, fiscal_year, paid_on, amount_santim, received_from, entered_by)
             select gen_random_uuid(), region_id, handling_unit_id, $1, case_id, issuer, reference, reference_norm,
                    fiscal_year - 1, paid_on - 366, amount_santim, received_from, entered_by
               from fees.external_payment_refs where issuer = 'REVENUE' and reference_norm = $2`,
            [lastYear.id, zeros]
        );
        // and the verifier is told the same number is live in another year
        expect((await orderOf(other.caseId, as.zoneFinance)).externalRefs[0]).toMatchObject({ sameNumberOtherYear: 1 });

        // a date moved to an older year can't make the same receipt another reference
        const moved = await orderOf((await filed(GUARDED)).id);
        expect((await enter(moved.id, { reference: zeros, paidOn: '2024-12-01' })).statusCode).toBe(422);
    });

    it('can be neither a slip taken at a till nor one after it, in another office too', async () => {
        const till = await orderOf((await filed(AT_TILL)).id, as.boditiCashier);
        const reference = fresh();
        const slip = await api.call(
            'POST',
            `/api/v1/payment-orders/${till.id}/payments`,
            as.boditiCashier,
            {
                method: 'bank_slip',
                amountSantim: '40000',
                receivedFrom: 'Generated Applicant',
                bankSlip: { bank: 'CBE', reference, paidOn: today() }
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(slip.statusCode, slip.body).toBe(201);
        const order = await orderOf((await filed(GUARDED)).id);
        const used = await enter(order.id, { issuer: 'CBE', reference });
        expect(used.json()).toMatchObject({ code: 'duplicate_reference' });

        // the same number in another fiscal year is another deposit
        const older = await orderOf((await filed(AT_TILL)).id, as.boditiCashier);
        const oldSlip = fresh();
        const taken2024 = await api.call(
            'POST',
            `/api/v1/payment-orders/${older.id}/payments`,
            as.boditiCashier,
            {
                method: 'bank_slip',
                amountSantim: '40000',
                receivedFrom: 'Generated Applicant',
                bankSlip: { bank: 'CBE', reference: oldSlip, paidOn: '2024-12-01' }
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(taken2024.statusCode, taken2024.body).toBe(201);
        const later = await orderOf((await filed(GUARDED)).id);
        expect((await enter(later.id, { issuer: 'CBE', reference: oldSlip })).statusCode).toBe(201);

        const reference2 = fresh();
        expect((await enter(order.id, { issuer: 'CBE', reference: reference2 })).statusCode).toBe(201);
        const till2 = await orderOf((await filed(AT_TILL)).id, as.boditiCashier);
        const taken = await api.call(
            'POST',
            `/api/v1/payment-orders/${till2.id}/payments`,
            as.boditiCashier,
            {
                method: 'bank_slip',
                amountSantim: '40000',
                receivedFrom: 'Generated Applicant',
                bankSlip: { bank: 'CBE', reference: reference2, paidOn: today() }
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(taken.json()).toMatchObject({ code: 'duplicate_reference' });
    });

    it('goes with its order when the fee changes: the key is free again', async () => {
        let c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const reference = fresh();
        expect((await enter(order.id, { reference })).statusCode).toBe(201);
        c = await caseOf(c.id);
        const theirs = c.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        const corrected = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'correct', comment: 'a public licence', answers: { ...theirs, grade: 'public-1' } },
            ifMatch(c.version)
        );
        expect(corrected.statusCode, corrected.body).toBe(200);
        const { rows } = await api.owner.query<{ state: string }>(
            'select state from fees.external_payment_refs where order_id = $1',
            [order.id]
        );
        expect(rows).toEqual([{ state: 'withdrawn' }]);
        const reissued = await orderOf(c.id);
        expect(reissued.totalSantim).toBe('55000');
        expect((await enter(reissued.id, { reference, amountSantim: '55000' })).statusCode).toBe(201);
    });
});

describe('a decision on a reference', () => {
    it('is by another person in a role the region names, on record, and the database keeps the rule', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const ref = (await enter(order.id, {}, as.counterFinance)).json<Ref>();

        // who entered it, though a finance officer; the head, whose role the region does not name; without the right
        expect((await decide(ref.id, as.counterFinance)).statusCode).toBe(403);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where event_type = 'access.denied' and diff ->> 'reason' = 'external_ref_self_decision'`
            )
        ).toBe(1);
        expect((await decide(ref.id, as.boditiHead)).statusCode).toBe(403);
        expect((await decide(ref.id, as.boditiRecords)).statusCode).toBe(403);
        await expect(
            api.owner.query(
                `update fees.external_payment_refs
                    set state = 'verified', verified_via = 'person', decided_by = entered_by, decided_at = now()
                  where id = $1`,
                [ref.id]
            )
        ).rejects.toThrow(/external_payment_refs_sod_check/);

        // another office's finance officer does not even see it
        expect((await decide(ref.id, as.damotFinance)).statusCode).toBe(404);
        const verified = await decide(ref.id, as.zoneFinance);
        expect(verified.statusCode, verified.body).toBe(200);
        expect(verified.json()).toMatchObject({ state: 'verified', verifiedVia: 'person' });
        expect((await decide(ref.id, as.zoneFinance)).statusCode).toBe(409);
    });

    it('verified, settles the order and moves a waiting case on, in its transaction', async () => {
        const c = await filed(WAITING);
        expect(c.state).toBe('payment');
        const order = await orderOf(c.id);
        const ref = (await enter(order.id)).json<Ref>();
        expect((await decide(ref.id, as.zoneFinance)).statusCode).toBe(200);
        expect(await orderOf(c.id)).toMatchObject({ state: 'settled' });
        const kase = await caseOf(c.id);
        expect(kase.state).toBe('done');
        expect(await factsOf(c.id)).toMatchObject({ payment: { orderId: order.id, settled: true } });
        expect(kase.events.filter((e) => e.kind === 'payment').map((e) => e.action)).toEqual([
            'reference_entered',
            'paid'
        ]);
        expect(
            await count(
                `select count(*)::int as n from kernel.outbox_events
                  where type = 'payment.settled.v1' and payload ->> 'externalRefId' = $1`,
                [ref.id]
            )
        ).toBe(1);
        for (const table of ['fees.external_payment_refs', 'fees.payment_orders'])
            expect(
                await count(
                    `select count(*)::int as n from kernel.audit_log where table_name = $1 and row_id = $2 and action = 'update'`,
                    [table, table.endsWith('refs') ? ref.id : order.id]
                ),
                table
            ).toBeGreaterThan(0);
    });

    it('rejected, says why, frees the key, and the next verifier sees it was rejected', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const reference = fresh();
        const ref = (await enter(order.id, { reference })).json<Ref>();
        expect((await decide(ref.id, as.zoneFinance, 'rejected')).statusCode).toBe(422);
        const rejected = await decide(ref.id, as.zoneFinance, 'rejected', 'the revenue office has no such receipt');
        expect(rejected.statusCode, rejected.body).toBe(200);
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: false } });

        const again = await enter(order.id, { reference });
        expect(again.statusCode, again.body).toBe(201);
        expect(again.json()).toMatchObject({ rejectedBefore: 1, state: 'pending_verification' });
        const kase = await caseOf(c.id, as.zoneFinance);
        expect(kase.events.find((e) => e.action === 'reference_rejected')?.payment?.note).toBe(
            'the revenue office has no such receipt'
        );
    });

    it('shows a reference only to the rights that cover it', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const ref = (await enter(order.id)).json<Ref>();
        expect((await orderOf(c.id, as.boditiRecords)).externalRefs.map((r) => r.id)).toEqual([ref.id]);
        // a licensing expert reads the case, not its payment
        expect((await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.boditiOfficer)).statusCode).toBe(403);
        expect((await api.call('GET', '/api/v1/external-payment-refs', as.boditiOfficer)).statusCode).toBe(403);
        // nor the reference on the case's timeline: whoever reads only the case sees that one was entered
        const timeline = (await caseOf(c.id, as.boditiOfficer)).events.find((e) => e.action === 'reference_entered');
        expect(timeline?.payment?.receiptNumber).toBeNull();
        const theirTimeline = (await caseOf(c.id, as.boditiRecords)).events.find(
            (e) => e.action === 'reference_entered'
        );
        expect(theirTimeline?.payment?.receiptNumber).toBe(`REVENUE/${ref.reference}`);
        const inbox = await api.call('GET', '/api/v1/external-payment-refs', as.zoneFinance);
        expect(inbox.json<{ items: Ref[] }>().items.map((r) => r.id)).toContain(ref.id);
        const theirs = await api.call('GET', '/api/v1/external-payment-refs', as.damotFinance);
        expect(theirs.json<{ items: Ref[] }>().items.map((r) => r.id)).not.toContain(ref.id);
    });
});

describe('a revocation', () => {
    it('is by a third person: the order is open again, and the reference can go on the right order', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const reference = fresh();
        const ref = (await enter(order.id, { reference })).json<Ref>();
        expect((await revoke(ref.id, as.zoneFinance)).statusCode).toBe(409);
        expect((await decide(ref.id, as.counterFinance)).statusCode).toBe(200);

        expect((await revoke(ref.id, as.counterFinance)).statusCode).toBe(403);
        expect((await revoke(ref.id, as.boditiRecords)).statusCode).toBe(403);
        const revoked = await revoke(ref.id, as.zoneFinance);
        expect(revoked.statusCode, revoked.body).toBe(200);
        expect(revoked.json()).toMatchObject({ state: 'revoked' });
        expect(await orderOf(c.id)).toMatchObject({ state: 'open' });
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: false } });
        expect((await revoke(ref.id, as.zoneFinance)).statusCode).toBe(409);

        const right = await orderOf((await filed(GUARDED)).id);
        expect((await enter(right.id, { reference })).statusCode).toBe(201);
    });

    it('of one a statement verified is not undone by entering it again', async () => {
        const c = await filed(GUARDED);
        const reference = fresh();
        const ref = (await enter((await orderOf(c.id)).id, { reference })).json<Ref>();
        const statement = await imported([`${reference},400,${today()}`]);
        expect((await orderOf(c.id)).externalRefs[0]).toMatchObject({ state: 'verified', verifiedVia: 'statement' });
        expect((await revoke(ref.id, as.zoneFinance)).statusCode).toBe(200);
        expect((await linesOf(statement))[0]).toMatchObject({ state: 'held', reason: 'reference_revoked' });

        const again = (await enter((await orderOf(c.id)).id, { reference })).json<Ref>();
        await matchEntered(system, deps, again.id);
        await processStatement(system, deps, statement);
        expect((await orderOf(c.id)).state).toBe('open');
        expect((await orderOf(c.id)).externalRefs[0]).toMatchObject({ id: again.id, state: 'pending_verification' });
        // a person still can
        expect((await decide(again.id, as.counterFinance)).statusCode).toBe(200);
    });

    it('is refused once the case is closed: its service was given', async () => {
        const c = await filed(WAITING);
        const ref = (await enter((await orderOf(c.id)).id)).json<Ref>();
        expect((await decide(ref.id, as.counterFinance)).statusCode).toBe(200);
        expect((await caseOf(c.id)).closed).toBe(true);
        expect((await revoke(ref.id, as.zoneFinance)).statusCode).toBe(409);
    });
});

describe('a statement', () => {
    it('verifies a reference on an exact match, and moves the case on with nobody acting', async () => {
        const c = await filed(WAITING);
        const reference = fresh();
        const ref = (await enter((await orderOf(c.id)).id, { reference })).json<Ref>();
        const statement = await imported([`${reference},400.00,${today()}`]);
        const lines = await linesOf(statement);
        expect(lines[0]).toMatchObject({ lineNo: 1, reference, state: 'matched' });
        // every line, and its verdict, on record
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log a join fees.external_statement_lines l on l.id = a.row_id
                  where a.table_name = 'fees.external_statement_lines' and l.statement_id = $1 and a.action = 'insert'`,
                [statement]
            )
        ).toBe(lines.length);
        expect(await orderOf(c.id)).toMatchObject({ state: 'settled' });
        expect((await orderOf(c.id)).externalRefs[0]).toMatchObject({
            id: ref.id,
            state: 'verified',
            verifiedVia: 'statement'
        });
        const kase = await caseOf(c.id);
        expect(kase.state).toBe('done');
        expect(kase.events.find((e) => e.action === 'paid')).toMatchObject({
            actorUserId: null,
            systemActor: 'system:fees'
        });
        const read = await api.call('GET', `/api/v1/external-statements/${statement}`, as.zoneFinance);
        expect(read.json()).toMatchObject({ state: 'processed', layout: 'placeholder-v1' });
        expect(read.json<{ counts: Record<string, number> }>().counts.matched).toBe(1);
    });

    it('leaves anything but an exact match to a person, with the reason, and settles nothing', async () => {
        const [a, b] = await Promise.all([filed(GUARDED), filed(GUARDED)]);
        const [wrongAmount, wrongDate] = [fresh(), fresh()];
        await enter((await orderOf(a.id)).id, { reference: wrongAmount });
        const dated = await enter((await orderOf(b.id)).id, { reference: wrongDate });
        expect(dated.statusCode).toBe(201);
        const statement = await imported([
            `${wrongAmount},399.99,${today()}`,
            `${wrongDate},400.00,2024-12-02`,
            `,400,${today()}`,
            `NOT-ENTERED-${fresh()},400,${today()}`
        ]);
        const lines = await linesOf(statement);
        expect(lines.slice(0, 4).map((l) => [l.state, l.reason])).toEqual([
            ['amount_mismatch', null],
            // another fiscal year: not this reference at all
            ['unmatched', null],
            ['invalid', 'reference'],
            ['unmatched', null]
        ]);
        expect(await orderOf(a.id)).toMatchObject({ state: 'open' });
        // what the verifier sees beside the reference
        const seen = (await orderOf(a.id, as.zoneFinance)).externalRefs[0];
        expect(seen?.statement).toMatchObject({ state: 'amount_mismatch', amountSantim: '39999' });
    });

    it('holds a date that differs in the same year, and a receipt older than the order', async () => {
        const c = await filed(GUARDED);
        const old = await orderOf(c.id);
        const reference = fresh();
        // both in the fiscal year of a date before the order: an old receipt used again is what this catches
        const paidOn = '2026-07-20';
        expect((await enter(old.id, { reference, paidOn })).statusCode).toBe(201);
        const differs = fresh();
        const other = await orderOf((await filed(GUARDED)).id);
        expect((await enter(other.id, { reference: differs, paidOn })).statusCode).toBe(201);
        const statement = await imported([`${reference},400,${paidOn}`, `${differs},400,2026-07-21`]);
        const lines = await linesOf(statement);
        expect(lines[0]).toMatchObject({ state: 'held', reason: 'paid_before_order' });
        expect(lines[1]).toMatchObject({ state: 'held', reason: 'date_differs' });
        expect(await orderOf(c.id)).toMatchObject({ state: 'open' });
    });

    it('never verifies what its importer entered, and a person still can', async () => {
        const c = await filed(GUARDED);
        const reference = fresh();
        const ref = (await enter((await orderOf(c.id)).id, { reference }, as.counterFinance)).json<Ref>();
        const statement = await imported([`${reference},400,${today()}`], as.counterFinance);
        const lines = await linesOf(statement, as.counterFinance);
        expect(lines[0]).toMatchObject({ state: 'held', reason: 'importer_entered' });
        expect(await orderOf(c.id)).toMatchObject({ state: 'open' });
        expect((await decide(ref.id, as.zoneFinance)).statusCode).toBe(200);
    });

    it("verifies only its office's subtree", async () => {
        const c = await filed(GUARDED);
        const reference = fresh();
        await enter((await orderOf(c.id)).id, { reference });
        const statement = await imported([`${reference},400,${today()}`], as.damotFinance);
        expect((await linesOf(statement, as.damotFinance))[0]).toMatchObject({ state: 'unmatched' });
        expect(await orderOf(c.id)).toMatchObject({ state: 'open' });
        // and the town's finance officer does not see the woreda's statement
        expect((await api.call('GET', `/api/v1/external-statements/${statement}`, as.counterFinance)).statusCode).toBe(
            404
        );
    });

    it('verifies a reference entered after it, when the worker looks', async () => {
        const c = await filed(GUARDED);
        const reference = fresh();
        await imported([`${reference},400,${today()}`]);
        const ref = (await enter((await orderOf(c.id)).id, { reference })).json<Ref>();
        await matchEntered(system, deps, ref.id);
        expect((await orderOf(c.id)).externalRefs[0]).toMatchObject({ state: 'verified', verifiedVia: 'statement' });
    });

    it('counts the same money once: within a file, and across statements that overlap', async () => {
        const reference = fresh();
        const first = await imported([`${reference},400,${today()}`, `${reference},400,${today()}`]);
        expect((await linesOf(first)).slice(0, 2).map((l) => [l.state, l.reason])).toEqual([
            ['unmatched', null],
            ['duplicate', 'in_this_file']
        ]);
        const second = await imported([`${reference},400,${today()}`]);
        expect((await linesOf(second))[0]).toMatchObject({ state: 'duplicate', reason: 'in_another_statement' });
    });

    it('is taken once, is told at once when it is not the layout, and a retry changes nothing', async () => {
        const content = `reference,amount,date\n${fresh()},400,${today()}\n`;
        const post = (body: string) =>
            api.call(
                'POST',
                '/api/v1/external-statements',
                as.zoneFinance,
                { issuer: 'CBE', statementDate: today(), filename: 'a.csv', content: body },
                { 'idempotency-key': randomUUID() }
            );
        expect((await post('reference,amount,date\nA\u0000B,1,2026-01-01')).statusCode).toBe(422);
        const first = await post(content);
        expect(first.statusCode, first.body).toBe(201);
        expect((await post(content)).json()).toMatchObject({ code: 'duplicate_reference' });
        expect((await post('ref,amt,when\nA,1,2026-01-01')).statusCode).toBe(422);
        expect(
            (
                await api.call(
                    'POST',
                    '/api/v1/external-statements',
                    as.boditiRecords,
                    {
                        issuer: 'CBE',
                        statementDate: today(),
                        filename: 'a.csv',
                        content
                    },
                    { 'idempotency-key': randomUUID() }
                )
            ).statusCode
        ).toBe(403);

        const id = first.json<{ id: string }>().id;
        await processStatement(system, deps, id);
        await processStatement(system, deps, id);
        expect((await linesOf(id)).length).toBe(1);
    });

    it('keeps a cell the database could not hold as a bad line, and reads the rest', async () => {
        const reference = fresh();
        const id = await imported([
            `${fresh()},"1,000,000,000,000,000,000,000",${today()}`,
            `${fresh()},400,0000-01-01`,
            `${reference},400,${today()}`
        ]);
        const lines = await linesOf(id);
        expect(lines.slice(0, 3).map((l) => [l.state, l.reason])).toEqual([
            ['invalid', 'amount'],
            ['invalid', 'date'],
            ['unmatched', null]
        ]);
        const read = await api.call('GET', `/api/v1/external-statements/${id}`, as.zoneFinance);
        expect(read.json()).toMatchObject({ state: 'processed' });
    });

    it('fails on record when the worker finds the file is not readable', async () => {
        const res = await api.call(
            'POST',
            '/api/v1/external-statements',
            as.zoneFinance,
            {
                issuer: 'REVENUE',
                statementDate: today(),
                filename: 'broken.csv',
                content: `reference,amount,date\n"${randomUUID()},400,${today()}\n`
            },
            { 'idempotency-key': randomUUID() }
        );
        expect(res.statusCode, res.body).toBe(201);
        const id = res.json<{ id: string }>().id;
        await processStatement(system, deps, id);
        const read = await api.call('GET', `/api/v1/external-statements/${id}`, as.zoneFinance);
        expect(read.json()).toMatchObject({ state: 'failed', failure: 'format' });
    });

    it('keeps what it filed, and its content stays out of the audit log', async () => {
        const reference = fresh();
        const id = await imported([`${reference},400,${today()}`]);
        await expect(
            api.owner.query(`update fees.external_statements set content = 'changed' where id = $1`, [id])
        ).rejects.toThrow(/keeps what the file said/);
        await expect(
            api.owner.query(`update fees.external_statement_lines set amount_santim = 1 where statement_id = $1`, [id])
        ).rejects.toThrow(/keeps what the file said/);
        await expect(api.owner.query(`delete from fees.external_statements where id = $1`, [id])).rejects.toThrow(
            /keeps what the file said/
        );
        const logged = await api.owner.query<{ diff: unknown }>(
            `select diff from kernel.audit_log where table_name = 'fees.external_statements' and row_id = $1 and action = 'insert'`,
            [id]
        );
        expect(JSON.stringify(logged.rows[0]?.diff)).toContain('sha256');
        expect(JSON.stringify(logged.rows)).not.toContain(reference);
    });

    it('a reference moves forward only, and what it says never changes', async () => {
        const c = await filed(GUARDED);
        const ref = (await enter((await orderOf(c.id)).id)).json<Ref>();
        await expect(
            api.owner.query(`update fees.external_payment_refs set amount_santim = 1 where id = $1`, [ref.id])
        ).rejects.toThrow(/moves forward once/);
        await expect(api.owner.query(`delete from fees.external_payment_refs where id = $1`, [ref.id])).rejects.toThrow(
            /moves forward once/
        );
    });
});
