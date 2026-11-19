/**
 * Payment orders, the cashier and receipts (task 0.22b, ADR-0042), on a real PostgreSQL 16. A case's fee becomes one
 * payment order (an effect run twice makes one; a changed fee reissues an open order and is refused once paid); its
 * total is the sum of its lines in santim. The cashier of the case's office records the whole total, by cash or a bank
 * slip, and the receipt is numbered gapless per office and fiscal year, also when payments come at the same moment and
 * one of them fails; a pad office records its pad's leaf instead. A reversal is decided by another person, in a role the
 * region names; it keeps the receipt's number and shows on the case. A case waiting on its payment moves on when paid;
 * one guarded on it may move on only then. Every write is audited; what is kept never changes.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { StationeryStock } from '@itrms/fees/api';
import { cancelClosedCaseOrder } from '@itrms/fees/api/worker';
import { importFeeRules } from '@itrms/fees/seed';
import { feeRuleSchema } from '@itrms/schemas';
import { createDatabase, type Database, type DbContext, type Tx } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { OrgUnit } from '@itrms/kernel/org';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import { efy } from '@itrms/ethiopian-calendar';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c301',
    zoneCashier: '0199f0a0-d000-7000-8000-000000000107',
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    // a licensing expert: reads the case, not its payment
    boditiOfficer: '0199f0a0-d000-7000-8000-000000000305',
    // a Boditi cashier who is also its finance officer: never decides a reversal of a receipt they took
    cashFinance: '0199f0a0-d000-7000-8000-00000000c302',
    // Boditi's store keeper: writes off a spoiled receipt leaf (never the cashier)
    keeper: '0199f0a0-d000-7000-8000-00000000c303'
};
const GUARDED = 'RS-05';
const WAITING = 'RS-06';
/** a service that waits on its payment and charges nothing */
const FREE = 'RS-07';
/** a service whose fee may be nothing, by the answers */
const ZERO = 'RS-04';

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const t = (en: string) => ({ am: en, en });
const year = efy(new Date());

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
// a payment step guarded on the fact: the head approves only once it is paid
const GUARDED_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        reviewer,
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: ['fees.createPaymentOrder'] },
        { from: 'review', to: 'review', action: 'recheck', label: t('Recheck'), effects: ['fees.createPaymentOrder'] },
        {
            from: 'review',
            to: 'review',
            action: 'correct',
            label: t('Correct'),
            amendsRequest: true,
            commentRequired: true,
            effects: ['fees.assess']
        },
        {
            from: 'review',
            to: 'done',
            action: 'approve',
            guard: { fact: 'payment.settled', op: 'eq', value: true }
        }
    ]
};
// a case that waits on its payment and moves on when it is paid
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
    rule: string | null
) {
    const wf = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, { key, name: t(key), definition });
    expect(wf.statusCode, wf.body).toBe(201);
    const published = await api.call('POST', `/api/v1/services/${code}/versions`, as.bureau, {
        workflowVersionId: wf.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId,
        feeRuleVersionId: rule,
        overridePolicy: {}
    });
    expect(published.statusCode, published.body).toBe(201);
}

/** A request filed at Boditi at the fee its preview showed, and submitted: its case. */
async function filed(code: string, grade = 'auto'): Promise<CaseOut> {
    const answers = { plate: `ETH ABC ${String(randomInt(1000, 10_000))}`, grade };
    const shown = (
        await api.call('POST', '/api/v1/fees/preview', as.boditiRecords, { serviceCode: code, answers })
    ).json<{ status: string; feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.boditiRecords, {
        serviceCode: code,
        answers,
        // the figure the counter showed (a service that charges nothing shows none)
        ...(shown.status === 'complete'
            ? { fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim } }
            : {})
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

interface Order {
    id: string;
    caseId: string;
    state: string;
    totalSantim: string;
    lines: { key: string; amountSantim: string }[];
    payments: { id: string; voided: boolean; receiptId: string | null; receiptNumber: string | null }[];
    reversals: { id: string; state: string }[];
}
const orderOf = async (caseId: string, who: As = as.boditiCashier) => {
    const res = await api.call('GET', `/api/v1/cases/${caseId}/payment`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Order>();
};
const pay = (orderId: string, body: object = {}, who: As = as.boditiCashier, key = randomUUID()) =>
    api.call(
        'POST',
        `/api/v1/payment-orders/${orderId}/payments`,
        who,
        { method: 'cash', amountSantim: '40000', receivedFrom: 'Generated Applicant', ...body },
        { 'idempotency-key': key }
    );
const caseOf = async (id: string, who: As = as.boditiHead) =>
    (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();
/** A case's facts (the API shows a case's steps and timeline, not its facts). */
const factsOf = async (id: string) =>
    (await api.owner.query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))
        .rows[0]?.facts;
const count = async (sql: string, params: unknown[] = []) =>
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
        },
        {
            username: 'test.boditi.cashfinance',
            sub: SUB.cashFinance,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'cashier'],
                ['WOL-BODITI', 'finance_officer']
            ]
        },
        {
            username: 'test.boditi.keeper',
            sub: SUB.keeper,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'plate_keeper']]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.zoneCashier = { sub: SUB.zoneCashier, unit: zone };
    as.zoneFinance = { sub: SUB.zoneFinance, unit: zone };
    as.boditiHead = { sub: SUB.boditiHead, unit: boditi };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.boditiCashier = { sub: SUB.boditiCashier, unit: boditi };
    as.boditiOfficer = { sub: SUB.boditiOfficer, unit: boditi };
    as.cashFinance = { sub: SUB.cashFinance, unit: boditi };
    as.keeper = { sub: SUB.keeper, unit: boditi };

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
    await publishService(GUARDED, 'licence-guarded', GUARDED_FLOW, form, rule);
    await publishService(WAITING, 'licence-waiting', WAITING_FLOW, form, rule);
    const free = await publishedForm('free-request', { ...FORM, fields: FORM.fields.filter((f) => f.type !== 'Fee') });
    await publishService(FREE, 'free-waiting', WAITING_FLOW, free, null);
    await api.installer.scoped({}, (tx) =>
        importFeeRules(tx, { id: region.id, regionId: region.regionId }, [
            {
                key: 'licence-zero',
                name: t('Licence, may be nothing (demo)'),
                document: feeRuleSchema.parse({
                    schemaVersion: 1,
                    demo: true,
                    inputs: { grade: { kind: 'choice' } },
                    lines: [
                        {
                            key: 'base',
                            label: t('Licence'),
                            kind: 'table',
                            input: 'grade',
                            rows: [
                                { value: 'auto', amount: '30000' },
                                { value: 'public-1', amount: '0' }
                            ]
                        }
                    ]
                })
            }
        ])
    );
    const zero = await api.owner.query<{ id: string }>(
        `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id
          where r.key = 'licence-zero'`
    );
    await publishService(ZERO, 'licence-zero', GUARDED_FLOW, form, zero.rows[0]?.id ?? '');
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('a payment order', () => {
    it("is the case's fee, once: its total the sum of its lines, a changed fee reissued, a paid one never changed", async () => {
        let c = await filed(GUARDED);
        const order = await orderOf(c.id);
        expect(order).toMatchObject({ state: 'open', totalSantim: '40000' });
        expect(order.lines.map((l) => [l.key, l.amountSantim])).toEqual([
            ['base', '30000'],
            ['card', '10000']
        ]);
        const { rows } = await api.owner.query<{ total: string; sum: string; fee: string }>(
            `select o.total_santim::text as total, sum(l.amount_santim)::text as sum,
                    (select total_santim::text from fees.case_fees where id = o.case_fee_id) as fee
               from fees.payment_orders o join fees.payment_order_lines l on l.order_id = o.id
              where o.id = $1 group by o.id`,
            [order.id]
        );
        expect(rows[0]).toEqual({ total: '40000', sum: '40000', fee: '40000' });
        expect(await factsOf(c.id)).toMatchObject({
            payment: { orderId: order.id, settled: false, totalSantim: '40000', collection: 'cashier' }
        });

        const act = async (body: object, who: As = as.boditiHead) => {
            const res = await api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));
            if (res.statusCode === 200) c = res.json<CaseOut>();
            return res;
        };
        // the effect run again: the same order
        expect((await act({ action: 'recheck' })).statusCode).toBe(200);
        expect(await count('select count(*)::int as n from fees.payment_orders where case_id = $1', [c.id])).toBe(1);
        // not approved before it is paid
        expect((await act({ action: 'approve' })).statusCode).toBe(409);

        // a changed fee: the open order cancelled and a new one issued
        const page = await caseOf(c.id);
        const theirs = page.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        const corrected = await act({
            action: 'correct',
            comment: 'a public licence',
            answers: { ...theirs, grade: 'public-1' }
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        const reissued = await orderOf(c.id);
        expect(reissued).toMatchObject({ state: 'open', totalSantim: '55000' });
        expect(reissued.id).not.toBe(order.id);
        expect(
            (
                await api.owner.query<{ state: string; cancel_reason: string }>(
                    'select state, cancel_reason from fees.payment_orders where id = $1',
                    [order.id]
                )
            ).rows[0]
        ).toEqual({ state: 'cancelled', cancel_reason: 'reassessed' });

        // paid, the case may go on; a fee changed after it was paid is refused, nothing written
        expect((await pay(reissued.id, { amountSantim: '55000' })).statusCode).toBe(201);
        // the payment changed the case (its facts, its timeline): read it again
        c = await caseOf(c.id);
        const again = await act({
            action: 'correct',
            comment: 'back to automobile',
            answers: { ...theirs, grade: 'auto' }
        });
        expect(again.statusCode).toBe(409);
        expect(again.json()).toMatchObject({ code: 'fee_already_paid' });
        expect(await count('select count(*)::int as n from fees.case_fees where case_id = $1', [c.id])).toBe(2);
        expect((await act({ action: 'approve' })).statusCode).toBe(200);
        expect(c.state).toBe('done');
    });
});

describe('a payment at the cashier', () => {
    it('takes the whole total at the till of the case office, issues its receipt once, and puts it on the case', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        // the queue of the office's till
        const queue = (await api.call('GET', '/api/v1/payment-orders', as.boditiCashier)).json<{ items: Order[] }>();
        expect(queue.items.map((o) => o.id)).toContain(order.id);

        // not another amount, not at another office's till (refused on record), not by someone without the right
        expect((await pay(order.id, { amountSantim: '39999' })).json()).toMatchObject({ code: 'amount_mismatch' });
        expect((await pay(order.id, {}, as.zoneCashier)).statusCode).toBe(403);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where event_type = 'access.denied' and diff ->> 'reason' = 'other_office_till'`
            )
        ).toBeGreaterThanOrEqual(1);
        expect((await pay(order.id, {}, as.boditiRecords)).statusCode).toBe(403);
        expect(
            (
                await pay(order.id, {
                    method: 'bank_slip',
                    bankSlip: { bank: 'NOPE', reference: 'FT1', paidOn: '2026-01-01' }
                })
            ).statusCode
        ).toBe(422);

        const key = randomUUID();
        const paid = await pay(order.id, {}, as.boditiCashier, key);
        expect(paid.statusCode, paid.body).toBe(201);
        const { receipt } = paid.json<{ receipt: { id: string; number: string; amountSantim: string } }>();
        expect(receipt.number).toMatch(new RegExp(`^WOL-BODITI/\\d{6}/${year}$`));
        expect(receipt.amountSantim).toBe('40000');
        // sent again with the same key: the same receipt, nothing more
        const replay = await pay(order.id, {}, as.boditiCashier, key);
        expect(replay.json<{ receipt: { id: string } }>().receipt.id).toBe(receipt.id);
        expect(await count('select count(*)::int as n from fees.receipts where order_id = $1', [order.id])).toBe(1);
        // paid already
        expect((await pay(order.id)).json()).toMatchObject({ code: 'already_settled' });

        const kase = await caseOf(c.id);
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: true } });
        expect(kase.events.find((e) => e.kind === 'payment')).toMatchObject({
            action: 'paid',
            payment: { receiptId: receipt.id, receiptNumber: receipt.number }
        });
        // every write on record
        const audit = await api.owner.query<{ table_name: string }>(
            `select distinct table_name from kernel.audit_log where table_name like 'fees.%' and row_id in (
                 select id from fees.payments where order_id = $1 union all select id from fees.receipts where order_id = $1
                 union all select $1::uuid)`,
            [order.id]
        );
        expect(audit.rows.map((r) => r.table_name).sort()).toEqual([
            'fees.payment_orders',
            'fees.payments',
            'fees.receipts'
        ]);
        // what is kept never changes
        await expect(
            api.owner.query('update fees.receipts set number = $1 where id = $2', ['X', receipt.id])
        ).rejects.toThrow(/append-only/);
        await expect(
            api.owner.query('update fees.payments set amount_santim = 1 where order_id = $1', [order.id])
        ).rejects.toThrow(/append-only/);
    });

    it('is taken once when two cashiers record it at the same moment', async () => {
        const order = await orderOf((await filed(GUARDED)).id);
        const [a, b] = await Promise.all([pay(order.id), pay(order.id, {}, as.cashFinance)]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
        expect(await count('select count(*)::int as n from fees.receipts where order_id = $1', [order.id])).toBe(1);
        // the case's payment panel is payment data: a licensing expert reads the case, not it
        expect((await api.call('GET', `/api/v1/cases/${order.caseId}/payment`, as.boditiOfficer)).statusCode).toBe(403);
    });

    it('numbers receipts gapless per office and fiscal year when they come at the same moment, one of them failing', async () => {
        const cases = await Promise.all(Array.from({ length: 8 }, () => filed(GUARDED)));
        const orders = await Promise.all(cases.map((c) => orderOf(c.id)));
        const before = await count(
            `select coalesce(max(sequence), 0)::int as n from fees.receipts where source = 'itrms' and fiscal_year = $1`,
            [year]
        );
        // one bank slip used twice: its second payment fails after the payment row is written, and gives nothing back
        const slip = { method: 'bank_slip', bankSlip: { bank: 'CBE', reference: 'FT 26-0001', paidOn: '2026-01-01' } };
        const results = await Promise.all(orders.map((o, i) => pay(o.id, i === 2 || i === 5 ? slip : {})));
        const codes = results.map((r) => r.statusCode).sort();
        expect(codes).toEqual([201, 201, 201, 201, 201, 201, 201, 409]);
        const { rows } = await api.owner.query<{ seq: string }>(
            `select sequence::text as seq from fees.receipts where source = 'itrms' and fiscal_year = $1 and sequence > $2
              order by sequence`,
            [year, before]
        );
        expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 7 }, (_, i) => before + i + 1));
    });

    it('refuses a slip reference with nothing left to compare, and takes one slip once however it is punctuated', async () => {
        const slip = (reference: string) => ({
            method: 'bank_slip',
            bankSlip: { bank: 'CBE', reference, paidOn: '2026-01-01' }
        });
        const first = await orderOf((await filed(GUARDED)).id);
        expect((await pay(first.id, slip('---'))).statusCode).toBe(422);
        expect((await pay(first.id, slip('FT/77.01'))).statusCode).toBe(201);
        const second = await orderOf((await filed(GUARDED)).id);
        expect((await pay(second.id, slip('FT-77 01'))).json()).toMatchObject({ code: 'duplicate_reference' });
    });

    it('shows a bank slip and reversals only to the rights that cover them', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const paid = await pay(order.id, {
            method: 'bank_slip',
            bankSlip: { bank: 'CBE', reference: 'FT 88-0001', paidOn: '2026-01-01' }
        });
        expect(paid.statusCode, paid.body).toBe(201);
        const { receipt } = paid.json<{ receipt: { id: string; number: string } }>();
        const reason = 'the applicant paid at the wrong bank';
        const asked = await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.boditiCashier, { reason });
        expect(asked.statusCode, asked.body).toBe(201);
        // the receipt says it waits: no second request is offered
        expect((await api.call('GET', `/api/v1/receipts/${receipt.id}`, as.boditiCashier)).json()).toMatchObject({
            reversed: false,
            reversalPending: true
        });

        type Shown = Order & { payments: { bank: string | null; slipReference: string | null }[] };
        const reasonOf = (kase: CaseOut) => kase.events.find((e) => e.action === 'reversal_requested')?.payment?.reason;
        const cashier = await orderOf(c.id);
        expect((cashier as Shown).payments[0]).toMatchObject({ bank: 'CBE', slipReference: 'FT 88-0001' });
        expect(cashier.reversals).toHaveLength(1);
        expect(reasonOf(await caseOf(c.id, as.boditiCashier))).toBe(reason);

        // a records officer reads the order and its receipts, not the slip nor the reversal
        const records = await orderOf(c.id, as.boditiRecords);
        expect((records as Shown).payments[0]).toMatchObject({
            bank: null,
            slipReference: null,
            receiptNumber: receipt.number
        });
        expect(records.reversals).toEqual([]);
        expect(
            (await api.call('GET', `/api/v1/payment-orders/${order.id}`, as.boditiRecords)).json<Order>().reversals
        ).toEqual([]);
        expect(reasonOf(await caseOf(c.id, as.boditiRecords))).toBeNull();
        // nor does whoever reads only the case see the reason on its timeline
        expect(reasonOf(await caseOf(c.id, as.boditiOfficer))).toBeNull();
    });

    it('refuses a pad payment without a leaf, and the pad fields at an office that numbers by ITRMS', async () => {
        const order = await orderOf((await filed(GUARDED)).id);
        expect((await pay(order.id, { pad: { series: 'ለ', serial: '1' } })).statusCode).toBe(422);
    });
});

describe('a reversal', () => {
    it('is decided by another person in a role the region names; the receipt keeps its number, the case shows it', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const paid = await pay(order.id, {}, as.cashFinance);
        expect(paid.statusCode, paid.body).toBe(201);
        const { receipt } = paid.json<{ receipt: { id: string; number: string } }>();

        const asked = await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.boditiCashier, {
            reason: 'the applicant paid twice'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const reversal = asked.json<{ id: string }>();
        expect(
            (
                await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.boditiCashier, {
                    reason: 'asked a second time'
                })
            ).statusCode
        ).toBe(409);
        const decide = (who: As, decision = 'approved') =>
            api.call('POST', `/api/v1/receipt-reversals/${reversal.id}/decision`, who, { decision });

        // not the cashier who took the money, though a finance officer (refused on record); not a role the region does
        // not name (the office's head); nor the cashier without the right
        expect((await decide(as.cashFinance)).statusCode).toBe(403);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where event_type = 'access.denied' and diff ->> 'reason' = 'reversal_self_decision'`
            )
        ).toBe(1);
        expect((await decide(as.boditiHead)).statusCode).toBe(403);
        expect((await decide(as.boditiCashier)).statusCode).toBe(403);
        // the database keeps the rule too
        await expect(
            api.owner.query(
                `update fees.receipt_reversals set state = 'approved', decided_by = requested_by, decided_at = now()
                  where id = $1`,
                [reversal.id]
            )
        ).rejects.toThrow(/receipt_reversals_sod_check/);

        const approved = await decide(as.zoneFinance);
        expect(approved.statusCode, approved.body).toBe(200);
        expect(approved.json()).toMatchObject({ state: 'approved', receiptNumber: receipt.number });
        expect((await decide(as.zoneFinance, 'rejected')).statusCode).toBe(409);

        const now = await orderOf(c.id);
        expect(now.state).toBe('open');
        expect(now.payments).toEqual([expect.objectContaining({ voided: true, receiptNumber: receipt.number })]);
        const shown = (await api.call('GET', `/api/v1/receipts/${receipt.id}`, as.boditiCashier)).json<unknown>();
        expect(shown).toMatchObject({ number: receipt.number, reversed: true });
        const kase = await caseOf(c.id);
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: false } });
        expect(kase.events.filter((e) => e.kind === 'payment').map((e) => e.action)).toEqual([
            'paid',
            'reversal_requested',
            'reversed'
        ]);
        // the order may be paid again, and the same receipt number is never issued again
        const again = await pay(now.id);
        expect(again.statusCode, again.body).toBe(201);
        expect(again.json<{ receipt: { number: string } }>().receipt.number).not.toBe(receipt.number);
    });
});

describe('a case', () => {
    it('waiting on its payment moves on when it is paid', async () => {
        const c = await filed(WAITING);
        expect(c.state).toBe('payment');
        const order = await orderOf(c.id);
        expect((await pay(order.id)).statusCode).toBe(201);
        const kase = await caseOf(c.id);
        expect(kase.state).toBe('done');
        expect(kase.events.find((e) => e.kind === 'transition' && e.to === 'done')).toMatchObject({
            systemActor: 'system:fees'
        });
    });

    it('whose fee was nothing and rises has its order at the till, and is no longer settled', async () => {
        const c = await filed(ZERO, 'public-1');
        expect(await factsOf(c.id)).toMatchObject({ payment: { orderId: null, settled: true, totalSantim: '0' } });
        const page = await caseOf(c.id);
        const theirs = page.steps.find((s) => s.answers && 'plate' in s.answers)?.answers ?? {};
        const raised = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'correct', comment: 'an automobile licence', answers: { ...theirs, grade: 'auto' } },
            ifMatch(page.version)
        );
        expect(raised.statusCode, raised.body).toBe(200);
        const order = await orderOf(c.id);
        expect(order).toMatchObject({ state: 'open', totalSantim: '30000' });
        expect(await factsOf(c.id)).toMatchObject({
            payment: { orderId: order.id, settled: false, totalSantim: '30000' }
        });
        // the guard on the fact holds it until the money comes
        const refused = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'approve' },
            ifMatch(raised.json<CaseOut>().version)
        );
        expect(refused.statusCode).toBe(409);
    });

    it('with nothing to pay does not wait on its payment', async () => {
        const c = await filed(FREE);
        expect(c.state).toBe('done');
        expect(await factsOf(c.id)).toMatchObject({ payment: { orderId: null, settled: true, totalSantim: '0' } });
    });

    it("closed after it was paid has its payment's reversal refused, and only rejected", async () => {
        let c = await filed(GUARDED);
        const order = await orderOf(c.id);
        const { receipt } = (await pay(order.id)).json<{ receipt: { id: string } }>();
        // asked while the case is open
        const asked = await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.boditiCashier, {
            reason: 'asked before the service was given'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        // the service is given: the case closes
        c = await caseOf(c.id);
        const approved = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/transitions`,
            as.boditiHead,
            { action: 'approve' },
            ifMatch(c.version)
        );
        expect(approved.statusCode, approved.body).toBe(200);
        expect(approved.json<CaseOut>().closed).toBe(true);
        const id = asked.json<{ id: string }>().id;
        const decide = (decision: string) =>
            api.call('POST', `/api/v1/receipt-reversals/${id}/decision`, as.zoneFinance, { decision });
        expect((await decide('approved')).statusCode).toBe(409);
        expect((await decide('rejected')).statusCode).toBe(200);
        expect(await factsOf(c.id)).toMatchObject({ payment: { settled: true } });
        // and a new request on the closed case is refused
        expect(
            (
                await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.boditiCashier, {
                    reason: 'asked after the service was given'
                })
            ).statusCode
        ).toBe(409);
    });

    it('closed with its order open has the order cancelled, once', async () => {
        const c = await filed(GUARDED);
        const order = await orderOf(c.id);
        await api.owner.query('update workflow.cases set closed_at = now() where id = $1', [c.id]);
        expect(await cancelClosedCaseOrder(system, c.id)).toBe(true);
        expect(await cancelClosedCaseOrder(system, c.id)).toBe(false);
        expect(
            (
                await api.owner.query<{ state: string; cancel_reason: string }>(
                    'select state, cancel_reason from fees.payment_orders where id = $1',
                    [order.id]
                )
            ).rows[0]
        ).toEqual({ state: 'cancelled', cancel_reason: 'case_closed' });
        expect((await pay(order.id)).statusCode).toBe(409);
    });
});

/** A pad receipt is a leaf of the office's own stock (task 1.12e, ADR-0063 §6). */
describe('a pad receipt', () => {
    const SERIES = 'ለ';
    const head = () => ({ sub: SUB.bureau, unit: as.bureau.unit });
    let setting: { version: number };
    let app: Database;
    let stock: StationeryStock;

    const ctxOf = (unit: OrgUnit): DbContext => ({ ...contextFor(unit), requestId: `pad-${randomUUID()}` });
    const run = <T>(unit: OrgUnit, work: (ctx: DbContext) => (tx: Tx) => Promise<T>) => {
        const ctx = ctxOf(unit);
        return app.scoped(ctx, work(ctx));
    };
    const range = { series: SERIES, from: 1, to: 30 };
    const leaf = (serial: string, series = SERIES) => ({ pad: { series, serial } });
    const ZONE_SERIES = 'ሐ';
    const itemOf = async (serial: number, series = SERIES) =>
        (
            await api.owner.query<{
                id: string;
                status: string;
                holder_unit_id: string;
                used_for_table: string | null;
                used_for_id: string | null;
            }>(
                `select id, status, holder_unit_id, used_for_table, used_for_id from fees.stationery_items
                  where kind = 'receipt_leaf' and series = $1 and serial = $2`,
                [series, serial]
            )
        ).rows[0];
    const written = async (orderId: string) => ({
        payments: await count('select count(*)::int as n from fees.payments where order_id = $1', [orderId]),
        receipts: await count('select count(*)::int as n from fees.receipts where order_id = $1', [orderId]),
        sessions: await count('select count(*)::int as n from fees.cashier_sessions'),
        movements: await count("select count(*)::int as n from fees.stationery_movements where kind = 'receipt_leaf'")
    });
    // a spoiled or torn leaf goes to the keeper, who writes it off (the 1.12a path): never the cashier
    const writeOff = (key: string, who: As = as.keeper, reason = 'misprinted at the print shop') =>
        api.call(
            'POST',
            '/api/v1/stationery/write-offs',
            who,
            { kind: 'receipt_leaf', status: 'void', items: { keys: [key] }, endReason: 'damaged', reason },
            { 'idempotency-key': randomUUID() }
        );
    const newOrder = async () => (await orderOf((await filed(GUARDED)).id)).id;

    beforeAll(async () => {
        const boditi = as.boditiCashier.unit;
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${boditi.id}/settings/fees.receipts.source`,
            head(),
            { value: 'pad' },
            ifMatch(0)
        );
        expect(set.statusCode, set.body).toBe(200);
        setting = set.json<{ version: number }>();
        app = createDatabase(pg.url('app'), {
            auditKey: randomBytes(32).toString('hex'),
            contextKey: TEST_CONTEXT_KEY
        });
        stock = api.http.get(StationeryStock);
        const bureau = as.bureau.unit;
        const zone = await api.unit('SER', 'WOL');
        const received = await run(
            bureau,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    kind: 'receipt_leaf',
                    source: 'finance_bureau',
                    reference: `PAD-${randomUUID().slice(0, 8)}`,
                    receivedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date()),
                    range,
                    width: 6
                })
        );
        expect(received.quantity).toBe(30);
        const down = async (from: OrgUnit, to: OrgUnit) => {
            const sent = await run(
                from,
                (ctx) => (tx) => stock.allocate(tx, ctx, { kind: 'receipt_leaf', toUnitId: to.id, items: range })
            );
            await run(to, (ctx) => (tx) => stock.accept(tx, ctx, sent.id, {}));
        };
        await down(bureau, zone);
        await down(zone, boditi);
        // leaves the zone's store keeps: in stock, but not at Boditi's till
        await run(
            bureau,
            (ctx) => (tx) =>
                stock.receive(tx, ctx, {
                    kind: 'receipt_leaf',
                    source: 'finance_bureau',
                    reference: `PAD-${randomUUID().slice(0, 8)}`,
                    receivedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date()),
                    range: { series: ZONE_SERIES, from: 1, to: 5 },
                    width: 6
                })
        );
        const sent = await run(
            bureau,
            (ctx) => (tx) =>
                stock.allocate(tx, ctx, {
                    kind: 'receipt_leaf',
                    toUnitId: zone.id,
                    items: { series: ZONE_SERIES, from: 1, to: 5 }
                })
        );
        await run(zone, (ctx) => (tx) => stock.accept(tx, ctx, sent.id, {}));
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        const reset = await api.call(
            'DELETE',
            `/api/v1/org-units/${as.boditiCashier.unit.id}/settings/fees.receipts.source`,
            head(),
            undefined,
            ifMatch(setting.version)
        );
        expect(reset.statusCode).toBeLessThan(300);
    });

    it("is refused without a leaf (422), and offers the office's lowest free one", async () => {
        const orderId = await newOrder();
        expect((await pay(orderId)).statusCode).toBe(422);
        const next = await api.call('GET', '/api/v1/receipt-leaves/next', as.boditiCashier);
        expect(next.statusCode, next.body).toBe(200);
        expect(next.json()).toEqual({ leaf: { series: SERIES, serial: '000001' } });
        // a records officer has no till
        expect((await api.call('GET', '/api/v1/receipt-leaves/next', as.boditiRecords)).statusCode).toBe(403);
    });

    it("uses one held leaf in the payment's transaction: the stock names the payment, `7` and `000007` are one leaf", async () => {
        const orderId = await newOrder();
        const paid = await pay(orderId, leaf('7'));
        expect(paid.statusCode, paid.body).toBe(201);
        const body = paid.json<{ receipt: { source: string; number: string }; order: Order }>();
        expect(body.receipt).toMatchObject({ source: 'pad', number: `${SERIES}/000007` });
        const paymentId = body.order.payments[0]?.id;
        expect(await itemOf(7)).toMatchObject({
            status: 'used',
            used_for_table: 'fees.payments',
            used_for_id: paymentId
        });
        expect(
            (
                await api.owner.query<{ pad_series: string; pad_serial: string; number: string }>(
                    'select pad_series, pad_serial, number from fees.receipts where order_id = $1',
                    [orderId]
                )
            ).rows[0]
        ).toEqual({ pad_series: SERIES, pad_serial: '000007', number: `${SERIES}/000007` });
        expect(
            await count(
                `select count(*)::int as n from fees.stationery_movements
                  where kind = 'receipt_leaf' and movement = 'use' and first_key = $1`,
                [`${SERIES}000007`]
            )
        ).toBe(1);
        // the form offers the leaf after the person's own last one; someone who used none gets the lowest free one
        const nextFor = async (who: As) =>
            (await api.call('GET', '/api/v1/receipt-leaves/next', who)).json<{ leaf: { serial: string } }>().leaf;
        expect(await nextFor(as.boditiCashier)).toEqual({ series: SERIES, serial: '000008' });
        expect(await nextFor(as.cashFinance)).toEqual({ series: SERIES, serial: '000001' });
        // the same leaf written with its zeros, for another order: used already
        const other = await newOrder();
        const again = await pay(other, leaf('000007'));
        expect(again.statusCode).toBe(409);
        expect(await written(other)).toMatchObject({ payments: 0, receipts: 0 });
    });

    it('refuses a leaf not held, used or spoiled (409) and writes nothing', async () => {
        const orderId = await newOrder();
        expect((await writeOff(`${SERIES}000009`)).statusCode).toBe(201);
        const before = await written(orderId);
        for (const serial of ['999', '000007', '9']) {
            const res = await pay(orderId, leaf(serial));
            expect(res.statusCode, `${serial}: ${res.body}`).toBe(409);
            expect(await written(orderId)).toEqual(before);
        }
        // a series the office does not hold
        expect((await pay(orderId, leaf('9', 'ሐ'))).statusCode).toBe(409);
        expect(await written(orderId)).toEqual(before);
        expect(
            await count('select count(*)::int as n from fees.payment_orders where id = $1 and state = $2', [
                orderId,
                'open'
            ])
        ).toBe(1);
    });

    it("refuses a leaf in stock but held by another office of the region (the zone's store) and writes nothing", async () => {
        const orderId = await newOrder();
        const before = await written(orderId);
        const res = await pay(orderId, leaf('3', ZONE_SERIES));
        expect(res.statusCode, res.body).toBe(409);
        expect(await written(orderId)).toEqual(before);
        const zone = await api.unit('SER', 'WOL');
        expect(await itemOf(3, ZONE_SERIES)).toMatchObject({ status: 'in_stock', holder_unit_id: zone.id });
    });

    it('is refused at an office that does not hold stationery (409 not_configured)', async () => {
        const regionId = as.boditiCashier.unit.regionId;
        const set = (sql: string) =>
            api.owner.query(
                `update kernel.unit_types set capabilities = ${sql} where key = 'town_unit_f1' and region_id = $1`,
                [regionId]
            );
        const orderId = await newOrder();
        await set("array_remove(capabilities, 'holds_stationery')");
        try {
            const res = await pay(orderId, leaf('11'));
            expect(res.statusCode, res.body).toBe(409);
            expect(res.json()).toMatchObject({ code: 'not_configured' });
            expect(await written(orderId)).toMatchObject({ payments: 0, receipts: 0 });
        } finally {
            await set("array_append(capabilities, 'holds_stationery')");
        }
        expect((await pay(orderId, leaf('11'))).statusCode).toBe(201);
    });

    it('lets two cashiers race for one leaf: exactly one wins, the other leaves nothing', async () => {
        const [a, b] = [await newOrder(), await newOrder()];
        const results = await Promise.all([
            pay(a, leaf('13'), as.boditiCashier),
            pay(b, leaf('000013'), as.cashFinance)
        ]);
        expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
        const winner = results[0]?.statusCode === 201 ? a : b;
        const loser = winner === a ? b : a;
        expect(await written(loser)).toMatchObject({ payments: 0, receipts: 0 });
        expect((await written(winner)).receipts).toBe(1);
        expect(await itemOf(13)).toMatchObject({ status: 'used' });
    });

    it("takes the leaf's use into the payment's own transaction: one audit row on the item beside the payment's", async () => {
        const orderId = await newOrder();
        const paid = await pay(orderId, leaf('14'));
        expect(paid.statusCode, paid.body).toBe(201);
        const paymentId = paid.json<{ order: Order }>().order.payments[0]?.id;
        const item = await itemOf(14);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log u
                   join kernel.audit_log p on p.request_id = u.request_id
                  where u.table_name = 'fees.stationery_items' and u.row_id = $1 and u.action = 'update'
                    and p.table_name = 'fees.payments' and p.row_id = $2 and p.action = 'insert'`,
                [item?.id, paymentId]
            )
        ).toBe(1);
    });

    it('keeps the leaf used when its receipt is reversed: the reopened order needs a new leaf', async () => {
        const orderId = await newOrder();
        const paid = await pay(orderId, leaf('17'));
        expect(paid.statusCode, paid.body).toBe(201);
        const { receipt } = paid.json<{ receipt: { id: string } }>();
        const asked = await api.call('POST', `/api/v1/receipts/${receipt.id}/reversals`, as.cashFinance, {
            reason: 'the applicant paid at the wrong office'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const decided = await api.call(
            'POST',
            `/api/v1/receipt-reversals/${asked.json<{ id: string }>().id}/decision`,
            as.zoneFinance,
            { decision: 'approved' }
        );
        expect(decided.statusCode, decided.body).toBe(200);
        expect(await itemOf(17)).toMatchObject({ status: 'used' });
        // the order is open again: the old leaf is refused, a new one takes the payment
        expect((await pay(orderId, leaf('17'))).statusCode).toBe(409);
        expect((await pay(orderId, leaf('18'))).statusCode).toBe(201);
    });

    it('lets a payment and the keeper write off the same leaf race: one wins, the other is refused, consistently', async () => {
        const orderId = await newOrder();
        const [paid, off] = await Promise.all([pay(orderId, leaf('20')), writeOff(`${SERIES}000020`)]);
        const codes = [paid.statusCode, off.statusCode].sort();
        expect(codes[1], `${paid.body} ${off.body}`).toBe(409);
        expect(codes[0]).toBeLessThan(300);
        const item = await itemOf(20);
        const receipts = (await written(orderId)).receipts;
        if (paid.statusCode === 201) expect([item?.status, receipts]).toEqual(['used', 1]);
        else expect([item?.status, receipts]).toEqual(['void', 0]);
    });

    it('is written off by the keeper with a reason, on record and audited; never by the cashier', async () => {
        const res = await writeOff(`${SERIES}000015`);
        expect(res.statusCode, res.body).toBe(201);
        const item = await itemOf(15);
        expect(item?.status).toBe('void');
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log
                  where table_name = 'fees.stationery_items' and row_id = $1 and action = 'update'`,
                [item?.id]
            )
        ).toBeGreaterThanOrEqual(1);
        expect(
            await count(
                `select count(*)::int as n from fees.stationery_movements
                  where kind = 'receipt_leaf' and movement = 'write_off' and first_key = $1 and reason is not null`,
                [`${SERIES}000015`]
            )
        ).toBe(1);
        // already written off, used, or not held: refused
        expect((await writeOff(`${SERIES}000015`)).statusCode).toBe(409);
        expect((await writeOff(`${SERIES}000007`)).statusCode).toBe(409);
        expect((await writeOff(`${SERIES}000999`)).statusCode).toBe(409);
        // a reason is 10 to 500 characters; the cashier and the records officer have no right to write off stock
        expect((await writeOff(`${SERIES}000016`, as.keeper, 'too short')).statusCode).toBe(422);
        expect((await writeOff(`${SERIES}000016`, as.boditiCashier)).statusCode).toBe(403);
        expect((await writeOff(`${SERIES}000016`, as.boditiRecords)).statusCode).toBe(403);
        expect(await itemOf(16)).toMatchObject({ status: 'in_stock' });
        // the receipt-leaves API has no spoil path for the cashier
        expect(
            (
                await api.call('POST', '/api/v1/receipt-leaves/spoiled', as.boditiCashier, {
                    key: `${SERIES}000016`,
                    reason: 'misprinted at the print shop'
                })
            ).statusCode
        ).toBe(404);
        // a written-off leaf is not written on
        const orderId = await newOrder();
        expect((await pay(orderId, leaf('15'))).statusCode).toBe(409);
    });

    it('shows as used and written-off leaves in the stationery reconciliation of the office', async () => {
        const boditi = as.boditiCashier.unit;
        const summary = await run(boditi, (ctx) => (tx) => stock.summary(tx, ctx, 'receipt_leaf'));
        const used = await count(
            "select count(*)::int as n from fees.stationery_items where kind = 'receipt_leaf' and status = 'used' and holder_unit_id = $1",
            [boditi.id]
        );
        const voided = await count(
            "select count(*)::int as n from fees.stationery_items where kind = 'receipt_leaf' and status = 'void' and holder_unit_id = $1",
            [boditi.id]
        );
        expect(used).toBeGreaterThanOrEqual(5);
        expect(voided).toBeGreaterThanOrEqual(2);
        expect(summary.unit).toMatchObject({ used, void: voided, reconciled: true });
        expect(summary.unit.inStock).toBe(30 - used - voided);
    });
});
