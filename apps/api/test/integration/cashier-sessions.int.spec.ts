/**
 * Cashier sessions and the daily closing (task 1.12, ADR-0063), on a real PostgreSQL 16. The first payment of the day opens
 * the cashier's session (a float of zero); an explicit opening takes a float and is refused while one is open; an earlier
 * day's open session is overdue and is never joined. The cashier counts: a count that matches closes the session, a
 * difference needs a note and another person's decision, never the cashier's own; a rejected count is made again, against the
 * figure the first count froze. The database refuses a payment into a closed session or another cashier's, and any change to a
 * closed one. A reversal decided after the till was counted is marked and leaves the closed session as it was. Payments and
 * counts at the same moment leave the frozen figures equal to the payments. Every write is audited; the isolation matrix.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { importFeeRules } from '@itrms/fees/seed';
import { createDatabase, type Database } from '@itrms/kernel/db';
import type { OrgUnit } from '@itrms/kernel/org';
import { asUnit, ISOLATION_CASES, TEST_CONTEXT_KEY, VISIBLE, type IsolationCase } from '@itrms/kernel/testing';
import { feeRuleSchema } from '@itrms/schemas';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c301',
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    boditiCashier: '0199f0a0-d000-7000-8000-000000000303',
    // Boditi cashiers of their own, so that a test's session is its own
    cashA: '0199f0a0-d000-7000-8000-00000000c411',
    cashB: '0199f0a0-d000-7000-8000-00000000c412',
    cashC: '0199f0a0-d000-7000-8000-00000000c413',
    cashD: '0199f0a0-d000-7000-8000-00000000c414',
    cashE: '0199f0a0-d000-7000-8000-00000000c415',
    cashF: '0199f0a0-d000-7000-8000-00000000c416',
    // a Boditi cashier who is also its finance officer: never decides a count they made
    cashFinance: '0199f0a0-d000-7000-8000-00000000c417'
};
const WAITING = 'RS-05';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
const as = {} as Record<keyof typeof SUB, As>;
const units = {} as Record<'ser' | 'zone' | 'boditi' | 'tzb' | 'tzbW1' | 'trx', OrgUnit>;
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
        { id: 'fee', type: 'Fee', category: 'Data', label: t('Fee'), props: { showLines: true } }
    ]
};
const RULE = {
    schemaVersion: 1 as const,
    demo: true,
    inputs: {},
    lines: [{ key: 'base', label: t('Licence'), kind: 'fixed' as const, amount: '40000' }]
};
// the case stays open after its payment (a closed case's reversal is not decided here)
const WAITING_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        { key: 'review', kind: 'task', label: t('Review'), assignee: { role: 'unit_head', unit: 'handling' } },
        { key: 'done', kind: 'end', label: t('Done') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: ['fees.createPaymentOrder'] },
        { from: 'review', to: 'done', action: 'approve' }
    ]
};

async function setUpService() {
    const region = units.ser;
    await api.installer.scoped({}, (tx) =>
        importFeeRules(tx, { id: region.id, regionId: region.regionId }, [
            { key: 'session-demo', name: t('Session demo'), document: feeRuleSchema.parse(RULE) }
        ])
    );
    const { rows } = await api.owner.query<{ id: string }>(
        `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id where r.key = 'session-demo'`
    );
    const rule = rows[0]?.id ?? '';
    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: 'session-request',
        name: t('s'),
        document: FORM
    });
    expect(created.statusCode, created.body).toBe(201);
    const asked = await api.call(
        'POST',
        `/api/v1/forms/${created.json<{ id: string }>().id}/publications`,
        as.bureau,
        {}
    );
    const pub = asked.json<{ id: string; version: number; formVersion: { id: string } }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${pub.id}/approval`,
        as.bureau2,
        {},
        ifMatch(pub.version)
    );
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    const wf = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'session-waiting',
        name: t('s'),
        definition: WAITING_FLOW
    });
    expect(wf.statusCode, wf.body).toBe(201);
    const published = await api.call('POST', `/api/v1/services/${WAITING}/versions`, as.bureau, {
        workflowVersionId: wf.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId: pub.formVersion.id,
        feeRuleVersionId: rule,
        overridePolicy: {}
    });
    expect(published.statusCode, published.body).toBe(201);
}

/** A request filed at Boditi at the fee its preview showed, and submitted: its payment order id. */
async function order(): Promise<string> {
    const answers = { plate: `ETH ABC ${String(randomInt(1000, 10_000))}` };
    const shown = (
        await api.call('POST', '/api/v1/fees/preview', as.boditiRecords, { serviceCode: WAITING, answers })
    ).json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.boditiRecords, {
        serviceCode: WAITING,
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
    const o = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.boditiCashier);
    return o.json<{ id: string }>().id;
}

const pay = (orderId: string, who: As, method: 'cash' | 'bank_slip' = 'cash') =>
    api.call(
        'POST',
        `/api/v1/payment-orders/${orderId}/payments`,
        who,
        {
            method,
            amountSantim: '40000',
            receivedFrom: 'Generated Applicant',
            ...(method === 'bank_slip'
                ? { bankSlip: { bank: 'CBE', reference: `FT ${randomUUID().slice(0, 8)}`, paidOn: '2026-01-01' } }
                : {})
        },
        { 'idempotency-key': randomUUID() }
    );
const paid = async (who: As, method: 'cash' | 'bank_slip' = 'cash') => {
    const res = await pay(await order(), who, method);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ receipt: { id: string } }>().receipt.id;
};

interface Session {
    id: string;
    state: string;
    openedVia: string;
    overdue: boolean;
    openingFloatSantim: string;
    cashReceiptsSantim: string;
    expectedCashSantim: string;
    receiptCount: number;
    counts: { id: string; state: string; attempt: number; expectedSantim: string }[];
}
const current = async (who: As) =>
    (await api.call('GET', '/api/v1/cashier-sessions/current', who)).json<{ today: Session[]; overdue: Session[] }>();
const count = (id: string, who: As, body: object) =>
    api.call('POST', `/api/v1/cashier-sessions/${id}/counts`, who, body);
const decide = (countId: string, who: As, body: object) =>
    api.call('POST', `/api/v1/cashier-session-counts/${countId}/decision`, who, body);
const rows = async <T>(query: string, params: unknown[] = []) => (await api.owner.query<T>(query, params)).rows;
const NOTE = 'The till is one Birr short';

beforeAll(async () => {
    pg = await startPostgres();
    const cashiers = (['cashA', 'cashB', 'cashC', 'cashD', 'cashE', 'cashF'] as const).map((k) => ({
        username: `test.session.${k.toLowerCase()}`,
        sub: SUB[k],
        region: 'SER' as const,
        home: 'WOL-BODITI',
        roles: [['WOL-BODITI', 'cashier']] as [string, string][]
    }));
    api = await startApi(pg, [
        {
            username: 'test.bureau.fourth',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        },
        {
            username: 'test.session.cashfinance',
            sub: SUB.cashFinance,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'cashier'],
                ['WOL-BODITI', 'finance_officer']
            ]
        },
        ...cashiers
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.tzb = await api.unit('SER', 'TZB');
    units.tzbW1 = await api.unit('SER', 'TZB-W1');
    units.trx = await api.unit('TRX', 'TRX-W1');
    for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) {
        const home = k === 'bureau' || k === 'bureau2' ? units.ser : k === 'zoneFinance' ? units.zone : units.boditi;
        as[k] = { sub: SUB[k], unit: home };
    }
    await setUpService();
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('opening a session', () => {
    it('is done by the first payment of the day with a float of zero, and the next payment joins it', async () => {
        expect((await current(as.cashA)).today).toEqual([]);
        await paid(as.cashA);
        const first = (await current(as.cashA)).today;
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            state: 'open',
            openedVia: 'payment',
            openingFloatSantim: '0',
            receiptCount: 1
        });
        await paid(as.cashA);
        const again = (await current(as.cashA)).today;
        expect(again.map((s) => s.id)).toEqual([first[0]?.id]);
        expect(again[0]).toMatchObject({ receiptCount: 2, cashReceiptsSantim: '80000', expectedCashSantim: '80000' });
        const named = await rows<{ n: number }>('select count(*)::int as n from fees.payments where session_id = $1', [
            first[0]?.id
        ]);
        expect(named[0]?.n).toBe(2);
    });

    it('is done by the cashier with a float, once while one is open, and the payment joins it', async () => {
        const opened = await api.call('POST', '/api/v1/cashier-sessions', as.cashB, { openingFloatSantim: '5000' });
        expect(opened.statusCode, opened.body).toBe(201);
        const session = opened.json<Session>();
        expect(session).toMatchObject({ state: 'open', openedVia: 'explicit', openingFloatSantim: '5000' });
        const twice = await api.call('POST', '/api/v1/cashier-sessions', as.cashB, { openingFloatSantim: '0' });
        expect(twice.statusCode).toBe(409);
        await paid(as.cashB);
        const now = (await current(as.cashB)).today;
        expect(now.map((s) => s.id)).toEqual([session.id]);
        expect(now[0]).toMatchObject({ expectedCashSantim: '45000' });
    });

    it('never joins an earlier day: that session is overdue, shown and not blocking', async () => {
        const cashier = await api.userId(SUB.cashC);
        const yesterday = await rows<{ d: string }>(`select (now() at time zone 'Africa/Addis_Ababa')::date - 1 as d`);
        await api.owner.query(
            `insert into fees.cashier_sessions (id, region_id, handling_unit_id, cashier_id, business_day, opened_via)
             values (gen_random_uuid(), $1, $2, $3, $4, 'explicit')`,
            [units.boditi.regionId, units.boditi.id, cashier, yesterday[0]?.d]
        );
        await paid(as.cashC);
        const now = await current(as.cashC);
        expect(now.today).toHaveLength(1);
        expect(now.today[0]).toMatchObject({ state: 'open', openedVia: 'payment', receiptCount: 1 });
        expect(now.overdue).toHaveLength(1);
        expect(now.overdue[0]).toMatchObject({ state: 'open', overdue: true, receiptCount: 0 });
    });
});

describe('the count and the closing', () => {
    it('closes the session when the count matches, and the next payment opens a new one', async () => {
        await paid(as.cashD);
        const [open] = (await current(as.cashD)).today;
        expect(open?.expectedCashSantim).toBe('40000');
        const done = await count(open?.id ?? '', as.cashD, { countedSantim: '40000' });
        expect(done.statusCode, done.body).toBe(201);
        expect(done.json<Session>()).toMatchObject({ state: 'closed' });
        expect(done.json<Session>().counts[0]).toMatchObject({ state: 'balanced', attempt: 1 });
        // a closed session is not counted again
        expect((await count(open?.id ?? '', as.cashD, { countedSantim: '40000' })).statusCode).toBe(409);
        await paid(as.cashD);
        const now = (await current(as.cashD)).today;
        expect(now.map((s) => s.state).sort()).toEqual(['closed', 'open']);
    });

    it('needs a note for a difference, checks the denominations, and waits for a decision by another person', async () => {
        await paid(as.cashE);
        const [open] = (await current(as.cashE)).today;
        const id = open?.id ?? '';
        const noNote = await count(id, as.cashE, { countedSantim: '39900' });
        expect(noNote.statusCode).toBe(422);
        expect(noNote.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('note');
        const short = await count(id, as.cashE, {
            countedSantim: '39900',
            denominations: [{ valueSantim: 10000, count: 4 }]
        });
        expect(short.statusCode).toBe(422);
        expect(short.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('denominations');
        const sent = await count(id, as.cashE, {
            countedSantim: '39900',
            denominations: [
                { valueSantim: 10000, count: 3 },
                { valueSantim: 5000, count: 1 },
                { valueSantim: 1000, count: 4 },
                { valueSantim: 500, count: 1 },
                { valueSantim: 100, count: 4 }
            ],
            note: NOTE
        });
        expect(sent.statusCode, sent.body).toBe(201);
        const pending = sent.json<Session>();
        expect(pending).toMatchObject({ state: 'pending_approval', expectedCashSantim: '40000' });
        const first = pending.counts[0];
        expect(first).toMatchObject({ state: 'pending', attempt: 1 });
        // a count while it waits is refused
        expect((await count(id, as.cashE, { countedSantim: '40000' })).statusCode).toBe(409);
        // the cashier cannot decide (no right to), and the owner cannot make them decide on the row
        expect((await decide(first?.id ?? '', as.cashE, { decision: 'approve' })).statusCode).toBe(403);
        await expect(
            api.owner.query(
                `update fees.cashier_session_counts set state = 'approved', decided_by = cashier_id, decided_at = now() where id = $1`,
                [first?.id]
            )
        ).rejects.toThrow(/sod_check/);
        // a reject needs a note
        expect((await decide(first?.id ?? '', as.zoneFinance, { decision: 'reject' })).statusCode).toBe(422);
        const rejected = await decide(first?.id ?? '', as.zoneFinance, { decision: 'reject', note: 'Count it again' });
        expect(rejected.statusCode, rejected.body).toBe(200);
        expect(rejected.json<Session>()).toMatchObject({ state: 'counting', expectedCashSantim: '40000' });
        // a decision is made once
        expect((await decide(first?.id ?? '', as.zoneFinance, { decision: 'approve' })).statusCode).toBe(409);
        // counted again against the figure frozen by the first count, a payment since opened another session
        const again = await count(id, as.cashE, { countedSantim: '40000' });
        expect(again.statusCode, again.body).toBe(201);
        expect(again.json<Session>()).toMatchObject({ state: 'closed' });
        expect(again.json<Session>().counts.map((c) => [c.attempt, c.state, c.expectedSantim])).toEqual([
            [1, 'rejected', '40000'],
            [2, 'balanced', '40000']
        ]);
    });

    it('is approved by another person, who closes the session; a cashier who is also finance never decides their own', async () => {
        await paid(as.cashF);
        const [open] = (await current(as.cashF)).today;
        const sent = await count(open?.id ?? '', as.cashF, {
            countedSantim: '41000',
            note: 'One Birr over, found later'
        });
        const countId = sent.json<Session>().counts[0]?.id ?? '';
        const approved = await decide(countId, as.zoneFinance, { decision: 'approve' });
        expect(approved.statusCode, approved.body).toBe(200);
        expect(approved.json<Session>()).toMatchObject({ state: 'closed' });

        await paid(as.cashFinance);
        const [mine] = (await current(as.cashFinance)).today;
        const own = await count(mine?.id ?? '', as.cashFinance, {
            countedSantim: '1',
            note: 'Short, a test difference'
        });
        const refused = await decide(own.json<Session>().counts[0]?.id ?? '', as.cashFinance, { decision: 'approve' });
        expect(refused.statusCode).toBe(403);
        const stillWaiting = await rows<{ state: string }>('select state from fees.cashier_sessions where id = $1', [
            mine?.id
        ]);
        expect(stillWaiting[0]?.state).toBe('pending_approval');
    });

    it("refuses another cashier's count", async () => {
        await paid(as.cashA);
        const [open] = (await current(as.cashA)).today;
        expect(
            (await count(open?.id ?? '', as.cashB, { countedSantim: '1', note: 'Not my own till at all' })).statusCode
        ).toBe(403);
    });
});

describe('what the database refuses', () => {
    it("a payment into a closed session or into another cashier's, and any change to a closed session", async () => {
        const receiptId = await paid(as.cashD);
        const [row] = await rows<{ id: string }>('select payment_id as id from fees.receipts where id = $1', [
            receiptId
        ]);
        const closed = await rows<{ id: string }>(
            `select s.id from fees.cashier_sessions s join fees.cashier_session_counts c on c.id = s.closing_count_id
              where s.state = 'closed' limit 1`
        );
        const spare = await order();
        const [o] = await rows<{ case_id: string }>('select case_id from fees.payment_orders where id = $1', [spare]);
        const copy = (session: string, by: string) =>
            api.owner.query(
                `insert into fees.payments (id, region_id, handling_unit_id, order_id, case_id, method, amount_santim, received_from, received_by, session_id)
                 select gen_random_uuid(), region_id, handling_unit_id, $2, $3, 'cash', 40000, 'Generated Applicant', $4, $5
                   from fees.payments where id = $1`,
                [row?.id, spare, o?.case_id, by, session]
            );
        const cashD = await api.userId(SUB.cashD);
        await expect(copy(closed[0]?.id ?? '', cashD)).rejects.toThrow(
            /payments_session_required|open cashier session/
        );
        const [open] = (await current(as.cashA)).today.filter((s) => s.state === 'open');
        await expect(copy(open?.id ?? '', cashD)).rejects.toThrow(/payments_session_fk/);
        await expect(
            api.owner.query(`update fees.cashier_sessions set state = 'open' where id = $1`, [closed[0]?.id])
        ).rejects.toThrow(/closed session never changes/);
        await expect(
            api.owner.query('delete from fees.cashier_sessions where id = $1', [closed[0]?.id])
        ).rejects.toThrow(/not allowed/);
        // the frozen figures of a session counted once are set once
        const [counted] = await rows<{ id: string }>(
            `select id from fees.cashier_sessions where state = 'pending_approval' limit 1`
        );
        await expect(
            api.owner.query(
                'update fees.cashier_sessions set cash_receipts_santim = 1, expected_cash_santim = 1 where id = $1',
                [counted?.id]
            )
        ).rejects.toThrow(/froze/);
    });
});

describe('a reversal after the till was counted', () => {
    const reverse = async (receiptId: string, who: As) => {
        const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, who, {
            reason: 'The applicant paid the wrong office'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const approved = await api.call(
            'POST',
            `/api/v1/receipt-reversals/${asked.json<{ id: string }>().id}/decision`,
            as.zoneFinance,
            { decision: 'approved' }
        );
        expect(approved.statusCode, approved.body).toBe(200);
        return asked.json<{ id: string }>().id;
    };

    it('is marked, and the closed session is not touched; inside an open session it is not', async () => {
        const inside = await reverse(await paid(as.boditiCashier), as.boditiCashier);
        const [a] = await rows<{ after_till_closed: boolean }>(
            'select after_till_closed from fees.receipt_reversals where id = $1',
            [inside]
        );
        expect(a?.after_till_closed).toBe(false);

        const receiptId = await paid(as.cashA);
        const [paidRow] = await rows<{ session_id: string }>(
            'select p.session_id from fees.payments p join fees.receipts r on r.payment_id = p.id where r.id = $1',
            [receiptId]
        );
        const counted = await count(paidRow?.session_id ?? '', as.cashA, {
            countedSantim: '0',
            note: 'Counted nothing at all'
        });
        expect(counted.statusCode, counted.body).toBe(201);
        const before = await rows<{ row_version: number; state: string; expected_cash_santim: string }>(
            'select row_version, state, expected_cash_santim::text from fees.cashier_sessions where id = $1',
            [paidRow?.session_id]
        );
        const outside = await reverse(receiptId, as.cashA);
        const [b] = await rows<{ after_till_closed: boolean }>(
            'select after_till_closed from fees.receipt_reversals where id = $1',
            [outside]
        );
        expect(b?.after_till_closed).toBe(true);
        const after = await rows<{ row_version: number; state: string; expected_cash_santim: string }>(
            'select row_version, state, expected_cash_santim::text from fees.cashier_sessions where id = $1',
            [paidRow?.session_id]
        );
        expect(after).toEqual(before);
    });
});

describe('payments and counts at the same moment', () => {
    it('leave the frozen figures equal to the payments of the session (before any reversal)', async () => {
        const who = as.cashA;
        const orders = await Promise.all(Array.from({ length: 4 }, () => order()));
        const [open] = (await current(who)).today.filter((s) => s.state === 'open');
        const sessionId = open?.id;
        const results = await Promise.all([
            ...orders.map((o) => pay(o, who)),
            sessionId
                ? count(sessionId, who, { countedSantim: '1', note: 'A count in the middle of the day' })
                : undefined
        ]);
        expect(results.every((r) => (r?.statusCode ?? 200) < 300 || r?.statusCode === 409)).toBe(true);
        const sessions = await rows<{ id: string; cash: string | null; n: number | null; live: string; lives: number }>(
            `select s.id, s.cash_receipts_santim::text as cash, s.receipt_count as n,
                    coalesce((select sum(amount_santim) from fees.payments p where p.session_id = s.id), 0)::text as live,
                    (select count(*) from fees.payments p where p.session_id = s.id)::int as lives
               from fees.cashier_sessions s where s.cashier_id = $1 and s.till_closed_at is not null`,
            [await api.userId(SUB.cashA)]
        );
        for (const s of sessions) {
            expect(s.cash, s.id).toBe(s.live);
            expect(s.n, s.id).toBe(s.lives);
        }
    });

    it('lets one of two counts through', async () => {
        await paid(as.cashB);
        const [open] = (await current(as.cashB)).today.filter((s) => s.state === 'open');
        const [a, b] = await Promise.all([
            count(open?.id ?? '', as.cashB, { countedSantim: '1', note: 'The first count of two' }),
            count(open?.id ?? '', as.cashB, { countedSantim: '2', note: 'The second count of two' })
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    });
});

describe('the audit', () => {
    it('has a row for every write of a session, its counts and its decision', async () => {
        const tables = await rows<{ t: string; a: string }>(
            `select distinct table_name as t, action as a from kernel.audit_log
              where table_name in ('fees.cashier_sessions', 'fees.cashier_session_counts')`
        );
        const lines = tables.map((r) => `${r.t}:${r.a}`).sort();
        expect(lines).toEqual([
            'fees.cashier_session_counts:insert',
            'fees.cashier_session_counts:update',
            'fees.cashier_sessions:insert',
            'fees.cashier_sessions:update'
        ]);
    });
});

describe('the isolation matrix (class T)', () => {
    const CASE_UNITS: Record<IsolationCase, () => OrgUnit> = {
        own: () => units.zone,
        child: () => units.boditi,
        parent: () => units.ser,
        sibling: () => units.tzb,
        otherZone: () => units.tzbW1,
        otherRegion: () => units.trx
    };
    const day = (c: IsolationCase) => `2026-0${ISOLATION_CASES.indexOf(c) + 1}-01`;

    beforeAll(async () => {
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS[c]();
            const session = randomUUID();
            await api.owner.query(
                `insert into fees.cashier_sessions (id, region_id, handling_unit_id, cashier_id, business_day, opened_via)
                 values ($1, $2, $3, gen_random_uuid(), $4, 'explicit')`,
                [session, unit.regionId, unit.id, day(c)]
            );
            await api.owner.query(
                `insert into fees.cashier_session_counts (id, region_id, handling_unit_id, session_id, attempt, cashier_id, counted_santim, expected_santim, difference_santim, counted_by, state)
                 select gen_random_uuid(), region_id, handling_unit_id, id, 1, cashier_id, 0, 0, 0, cashier_id, 'balanced'
                   from fees.cashier_sessions where id = $1`,
                [session]
            );
        }
    }, 120_000);

    const caseOfDay = (d: string) => ISOLATION_CASES.find((c) => day(c) === d);

    it.each([
        [
            'fees.cashier_sessions',
            `select business_day::text as d from fees.cashier_sessions where business_day < '2026-07-01'`
        ],
        [
            'fees.cashier_session_counts',
            `select s.business_day::text as d from fees.cashier_session_counts c join fees.cashier_sessions s on s.id = c.session_id where s.business_day < '2026-07-01'`
        ]
    ] as const)('shows the acting unit exactly the rows of %s its class allows', async (_table, query) => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (await tx.execute<{ d: string }>(sql.raw(query))).rows.map((r) => caseOfDay(r.d))
        );
        expect([...new Set(seen)].sort()).toEqual([...VISIBLE.transaction].sort());
    });

    it.each(['fees.cashier_sessions', 'fees.cashier_session_counts'])(
        'shows nothing of %s without a context, on a connection that has just served one',
        async (table) => {
            const one = createDatabase(pg.url('app'), { max: 1, contextKey: TEST_CONTEXT_KEY });
            try {
                await asUnit(one, units.zone, (tx) => tx.execute(sql.raw(`select count(*) from ${table}`)));
                const seen = await one.scoped({}, (tx) =>
                    tx.execute<{ n: string }>(sql.raw(`select count(*) as n from ${table}`))
                );
                expect(seen.rows[0]?.n).toBe('0');
            } finally {
                await one.close();
            }
        }
    );
});
