/**
 * Payment orders, the cashier and receipts (task 0.22b, ADR-0042), on a real PostgreSQL 16. A case's fee becomes one
 * payment order (an effect run twice makes one; a changed fee reissues an open order and is refused once paid); its
 * total is the sum of its lines in santim. The cashier of the case's office records the whole total, by cash or a bank
 * slip, and the receipt is numbered gapless per office and fiscal year, also when payments come at the same moment and
 * one of them fails; a pad office records its pad's leaf instead. A reversal is decided by another person, in a role the
 * region names; it keeps the receipt's number and shows on the case. A case waiting on its payment moves on when paid;
 * one guarded on it may move on only then. Every write is audited; what is kept never changes.
 */
import { randomUUID } from 'node:crypto';

import { cancelClosedCaseOrder } from '@itrms/fees/api/worker';
import { importFeeRules } from '@itrms/fees/seed';
import { feeRuleSchema } from '@itrms/schemas';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
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
    // a Boditi cashier who is also its finance officer: never decides a reversal of a receipt they took
    cashFinance: '0199f0a0-d000-7000-8000-00000000c302'
};
const GUARDED = 'RS-05';
const WAITING = 'RS-06';

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

async function publishService(code: string, key: string, definition: object, formVersionId: string, rule: string) {
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
    const answers = { plate: `ETH ABC ${String(Math.floor(Math.random() * 9000) + 1000)}`, grade };
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

interface Order {
    id: string;
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
    as.cashFinance = { sub: SUB.cashFinance, unit: boditi };

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
        const { rows } = await api.owner.query<{ sequence: string }>(
            `select sequence::text from fees.receipts where source = 'itrms' and fiscal_year = $1 and sequence > $2
              order by sequence`,
            [year, before]
        );
        expect(rows.map((r) => Number(r.sequence))).toEqual(Array.from({ length: 7 }, (_, i) => before + i + 1));
    });

    it('records the leaf of a pre-printed pad at an office that issues pad receipts', async () => {
        const boditi = as.boditiCashier.unit;
        const head = { sub: SUB.bureau, unit: as.bureau.unit };
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${boditi.id}/settings/fees.receipts.source`,
            head,
            { value: 'pad' },
            ifMatch(0)
        );
        expect(set.statusCode, set.body).toBe(200);
        try {
            const c = await filed(GUARDED);
            const order = await orderOf(c.id);
            expect((await pay(order.id)).statusCode).toBe(422);
            const paid = await pay(order.id, { pad: { series: 'WB-07', serial: '000123' } });
            expect(paid.statusCode, paid.body).toBe(201);
            expect(paid.json()).toMatchObject({ receipt: { source: 'pad', number: 'WB-07/000123' } });
            const other = await orderOf((await filed(GUARDED)).id);
            const used = await pay(other.id, { pad: { series: 'WB-07', serial: '000123' } });
            expect(used.json()).toMatchObject({ code: 'duplicate_reference' });
        } finally {
            const reset = await api.call(
                'DELETE',
                `/api/v1/org-units/${boditi.id}/settings/fees.receipts.source`,
                head,
                undefined,
                ifMatch(set.json<{ version: number }>().version)
            );
            expect(reset.statusCode).toBeLessThan(300);
        }
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
