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
import { createDatabase, type Database, type Tx } from '@itrms/kernel/db';
import type { OrgUnit } from '@itrms/kernel/org';
import { asUnit, ISOLATION_CASES, TEST_CONTEXT_KEY, VISIBLE, type IsolationCase } from '@itrms/kernel/testing';
import { feeRuleSchema } from '@itrms/schemas';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c301',
    zoneFinance: '0199f0a0-d000-7000-8000-000000000108',
    zoneAuditor: '0199f0a0-d000-7000-8000-000000000109',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301',
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
    cashFinance: '0199f0a0-d000-7000-8000-00000000c417',
    cashG: '0199f0a0-d000-7000-8000-00000000c418',
    cashH: '0199f0a0-d000-7000-8000-00000000c419',
    // a cashier at an office with no till (Damot Gale): cannot open a session
    cashX: '0199f0a0-d000-7000-8000-00000000c41a'
};
const WAITING = 'RS-05';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
const as = {} as Record<keyof typeof SUB, As>;
const units = {} as Record<'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'tzbW1' | 'trx', OrgUnit>;
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
const rows = async <T extends QueryResultRow>(query: string, params: unknown[] = []) =>
    (await api.owner.query<T>(query, params)).rows;
const NOTE = 'The till is one Birr short';

/**
 * Sessions of another day cannot be opened (a trigger refuses it): the one test that needs an earlier day's session writes it
 * as the table's owner with that one trigger off, in a transaction of its own, and switches it back on before the commit.
 */
async function asEarlierDays(work: () => Promise<void>) {
    await api.owner.query('begin');
    try {
        await api.owner.query('alter table fees.cashier_sessions disable trigger cashier_sessions_opens_open');
        await work();
        await api.owner.query('alter table fees.cashier_sessions enable trigger cashier_sessions_opens_open');
        await api.owner.query('commit');
    } catch (error) {
        await api.owner.query('rollback');
        throw error;
    }
}

/** A statement as the application's own role, at Boditi (the database's rules, whatever the service does). */
const asApp = <T>(work: (tx: Tx) => Promise<T>) => asUnit(app, units.boditi, work);
async function refusal(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        const e = error as { message: string; cause?: { message?: string } };
        return `${e.message} ${e.cause?.message ?? ''}`;
    }
    throw new Error('expected a refusal');
}
let yesterdaySession = '';

beforeAll(async () => {
    pg = await startPostgres();
    const cashiers = (['cashA', 'cashB', 'cashC', 'cashD', 'cashE', 'cashF', 'cashG', 'cashH'] as const).map((k) => ({
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
        {
            username: 'test.session.cashx',
            sub: SUB.cashX,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'cashier']]
        },
        ...cashiers
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    units.ser = await api.unit('SER', 'SER');
    units.zone = await api.unit('SER', 'WOL');
    units.boditi = await api.unit('SER', 'WOL-BODITI');
    units.damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    units.tzb = await api.unit('SER', 'TZB');
    units.tzbW1 = await api.unit('SER', 'TZB-W1');
    units.trx = await api.unit('TRX', 'TRX-W1');
    for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) {
        const home =
            k === 'bureau' || k === 'bureau2'
                ? units.ser
                : k === 'zoneFinance' || k === 'zoneAuditor'
                  ? units.zone
                  : k === 'cashX'
                    ? units.damot
                    : units.boditi;
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
        yesterdaySession = randomUUID();
        await asEarlierDays(async () => {
            await api.owner.query(
                `insert into fees.cashier_sessions (id, region_id, handling_unit_id, cashier_id, business_day, opened_via)
                 values ($1, $2, $3, $4, $5, 'explicit')`,
                [yesterdaySession, units.boditi.regionId, units.boditi.id, cashier, yesterday[0]?.d]
            );
        });
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

describe('a reversal against a count', () => {
    it('ends consistent in either order: it lowers what is expected, or it is marked after the till was counted', async () => {
        const receiptId = await paid(as.cashD);
        const [row] = await rows<{ session_id: string }>(
            'select p.session_id from fees.payments p join fees.receipts r on r.payment_id = p.id where r.id = $1',
            [receiptId]
        );
        const sessionId = row?.session_id ?? '';
        const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, as.cashD, {
            reason: 'The applicant paid the wrong office'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const reversalId = asked.json<{ id: string }>().id;
        const [counted, decided] = await Promise.all([
            count(sessionId, as.cashD, { countedSantim: '1', note: 'A count while a reversal is decided' }),
            api.call('POST', `/api/v1/receipt-reversals/${reversalId}/decision`, as.zoneFinance, {
                decision: 'approved'
            })
        ]);
        expect(counted.statusCode, counted.body).toBe(201);
        expect(decided.statusCode, decided.body).toBe(200);
        const [state] = await rows<{ after: boolean; expected: string; cash: string }>(
            `select r.after_till_closed as after, s.expected_cash_santim::text as expected, s.cash_receipts_santim::text as cash
               from fees.receipt_reversals r join fees.cashier_sessions s on s.id = $2 where r.id = $1`,
            [reversalId, sessionId]
        );
        // decided first, the reversal lowered what is expected; after the count, it is marked and counted against
        const [others] = await rows<{ n: string }>(
            `select coalesce(sum(p.amount_santim), 0)::text as n from fees.payments p
              where p.session_id = $1 and p.id <> (select payment_id from fees.receipts where id = $2)`,
            [sessionId, receiptId]
        );
        const rest = BigInt(others?.n ?? '0');
        expect(state?.expected).toBe((state?.after ? rest + 40000n : rest).toString());
        expect(state?.cash).toBe(state?.expected);
    });

    it('is not marked when it is rejected, though the till was counted', async () => {
        const receiptId = await paid(as.cashE);
        const [row] = await rows<{ session_id: string }>(
            'select p.session_id from fees.payments p join fees.receipts r on r.payment_id = p.id where r.id = $1',
            [receiptId]
        );
        const counted = await count(row?.session_id ?? '', as.cashE, {
            countedSantim: '0',
            note: 'Counted nothing at all'
        });
        expect(counted.statusCode, counted.body).toBe(201);
        const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, as.cashE, {
            reason: 'The applicant paid the wrong office'
        });
        const id = asked.json<{ id: string }>().id;
        const rejected = await api.call('POST', `/api/v1/receipt-reversals/${id}/decision`, as.zoneFinance, {
            decision: 'rejected',
            note: 'Not a reason'
        });
        expect(rejected.statusCode, rejected.body).toBe(200);
        const [v] = await rows<{ after_till_closed: boolean }>(
            'select after_till_closed from fees.receipt_reversals where id = $1',
            [id]
        );
        expect(v?.after_till_closed).toBe(false);
        await expect(
            api.owner.query('update fees.receipt_reversals set after_till_closed = true where id = $1', [id])
        ).rejects.toThrow(/decided once|after_till_check/);
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
        expect(results.slice(0, -1).every((r) => r?.statusCode === 201)).toBe(true);
        // the count itself was made, against the float and the cash taken before it
        const made = results[results.length - 1];
        if (sessionId) {
            expect(made?.statusCode, made?.body).toBe(201);
            const [c] = await rows<{ expected: string; float_cash: string }>(
                `select c.expected_santim::text as expected,
                        (s.opening_float_santim + coalesce((select sum(p.amount_santim) from fees.payments p
                          where p.session_id = s.id and p.method = 'cash' and p.voided_at is null), 0))::text as float_cash
                   from fees.cashier_session_counts c join fees.cashier_sessions s on s.id = c.session_id
                  where s.id = $1 and c.attempt = 1`,
                [sessionId]
            );
            expect(c?.expected).toBe(c?.float_cash);
        }
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

describe('what the database holds to, as the application role', () => {
    const countRow = (
        session: string,
        cashier: string,
        attempt: number,
        counted: number,
        expected: number,
        state: string,
        id = randomUUID()
    ) =>
        sql`insert into fees.cashier_session_counts (id, region_id, handling_unit_id, session_id, attempt, cashier_id, counted_santim, expected_santim, difference_santim, counted_by, state)
            values (${id}, ${units.boditi.regionId}, ${units.boditi.id}, ${session}, ${attempt}, ${cashier}, ${counted}::bigint, ${expected}::bigint, ${counted - expected}::bigint, ${cashier}, ${state})`;

    it('refuses a forged count, and a close with made-up frozen figures', async () => {
        await paid(as.cashG);
        const [open] = (await current(as.cashG)).today.filter((s) => s.state === 'open');
        const id = open?.id ?? '';
        const cashier = await api.userId(SUB.cashG);
        // a balanced count against a figure that is not the float and the cash taken
        expect(await refusal(asApp((tx) => tx.execute(countRow(id, cashier, 1, 0, 0, 'balanced'))))).toMatch(
            /counts_expected|first count is made against/
        );
        // attempts follow one another
        expect(await refusal(asApp((tx) => tx.execute(countRow(id, cashier, 2, 40000, 40000, 'balanced'))))).toMatch(
            /attempts follow/
        );
        // an honest count, then a close with figures that are not its payments'
        const honest = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(countRow(id, cashier, 1, 40000, 40000, 'balanced', honest));
                    await tx.execute(sql`update fees.cashier_sessions set state = 'closed', till_closed_at = now(),
                        cash_receipts_santim = 0, bank_slip_santim = 0, receipt_count = 0, expected_cash_santim = 0,
                        closing_count_id = ${honest}, closed_at = now() where id = ${id}`);
                })
            )
        ).toMatch(/frozen figures are those of its payments|frozen_live/);
        // the session is as it was
        const [now] = await rows<{ state: string }>('select state from fees.cashier_sessions where id = $1', [id]);
        expect(now?.state).toBe('open');
    });

    it('refuses a session to wait for a count that is not pending, or to be counted again without a rejection', async () => {
        const [open] = (await current(as.cashG)).today.filter((s) => s.state === 'open');
        const id = open?.id ?? '';
        const sent = await count(id, as.cashG, { countedSantim: '39000', note: 'A note of the difference' });
        expect(sent.statusCode, sent.body).toBe(201);
        const pendingCount = sent.json<Session>().counts[0]?.id ?? '';
        expect(
            await refusal(
                asApp((tx) => tx.execute(sql`update fees.cashier_sessions set state = 'counting' where id = ${id}`))
            )
        ).toMatch(/counted again after a rejected|latest_count/);
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(
                        sql`update fees.cashier_sessions set state = 'closed', closing_count_id = ${pendingCount}, closed_at = now() where id = ${id}`
                    )
                )
            )
        ).toMatch(/latest count|latest_count/);
        // the head is no approver the region names: refused on record
        expect((await decide(pendingCount, as.boditiHead, { decision: 'approve' })).statusCode).toBe(403);
        // the identity of a session never changes
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(sql`update fees.cashier_sessions set cashier_id = gen_random_uuid() where id = ${id}`)
                )
            )
        ).toMatch(/permission denied|only its state/);
    });

    it('refuses a session opened in another state or on another day, and a payment into another day', async () => {
        const unit = units.boditi;
        const insert = (state: string, day: string) =>
            sql`insert into fees.cashier_sessions (id, region_id, handling_unit_id, cashier_id, business_day, opened_via, state, till_closed_at, cash_receipts_santim, bank_slip_santim, receipt_count, expected_cash_santim)
                values (gen_random_uuid(), ${unit.regionId}, ${unit.id}, gen_random_uuid(), ${day}::date, 'explicit', ${state},
                  ${state === 'open' ? null : new Date().toISOString()}::timestamptz, ${state === 'open' ? null : 0}::bigint, ${state === 'open' ? null : 0}::bigint,
                  ${state === 'open' ? null : 0}::integer, ${state === 'open' ? null : 0}::bigint)`;
        const [today] = await rows<{ d: string }>(`select (now() at time zone 'Africa/Addis_Ababa')::date::text as d`);
        const [past] = await rows<{ d: string }>(
            `select ((now() at time zone 'Africa/Addis_Ababa')::date - 3)::text as d`
        );
        expect(await refusal(asApp((tx) => tx.execute(insert('counting', today?.d ?? ''))))).toMatch(
            /opened open, today/
        );
        expect(await refusal(asApp((tx) => tx.execute(insert('open', past?.d ?? ''))))).toMatch(/opened open, today/);
        // a payment into the earlier day's open session of its cashier
        const spare = await order();
        const [o] = await rows<{ case_id: string }>('select case_id from fees.payment_orders where id = $1', [spare]);
        const [model] = await rows<{ id: string }>('select id from fees.payments limit 1');
        const cashC = await api.userId(SUB.cashC);
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(sql`insert into fees.payments (id, region_id, handling_unit_id, order_id, case_id, method, amount_santim, received_from, received_by, session_id)
                        select gen_random_uuid(), region_id, handling_unit_id, ${spare}, ${o?.case_id}, 'cash', 40000, 'Generated Applicant', ${cashC}, ${yesterdaySession}
                          from fees.payments where id = ${model?.id}`)
                )
            )
        ).toMatch(/open cashier session of today|payments_session_required/);
    });
});

describe('the rules of the count and who sees what', () => {
    it("takes only the region's denominations, and whole non-negative pieces", async () => {
        await paid(as.cashH);
        const [open] = (await current(as.cashH)).today.filter((s) => s.state === 'open');
        const id = open?.id ?? '';
        const odd = await count(id, as.cashH, {
            countedSantim: '7',
            denominations: [{ valueSantim: 7, count: 1 }],
            note: NOTE
        });
        expect(odd.statusCode).toBe(422);
        expect(odd.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('denominations');
        const negative = await count(id, as.cashH, {
            countedSantim: '0',
            denominations: [{ valueSantim: 100, count: -1 }],
            note: NOTE
        });
        expect(negative.statusCode).toBe(422);
    });

    it('lets a cashier see their own sessions only, and the auditor the office and below', async () => {
        const mine = await api.call('GET', '/api/v1/cashier-sessions', as.cashB);
        const cashB = await api.userId(SUB.cashB);
        const items = mine.json<{ items: { cashierId: string }[] }>().items;
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.cashierId === cashB)).toBe(true);
        const [other] = (await current(as.cashA)).today;
        expect((await api.call('GET', `/api/v1/cashier-sessions/${other?.id}`, as.cashB)).statusCode).toBe(404);
        const seen = await api.call('GET', '/api/v1/cashier-sessions?limit=100', as.zoneAuditor);
        expect(seen.statusCode, seen.body).toBe(200);
        const cashA = await api.userId(SUB.cashA);
        expect(seen.json<{ items: { cashierId: string }[] }>().items.some((i) => i.cashierId === cashA)).toBe(true);
        expect((await api.call('GET', `/api/v1/cashier-sessions/${other?.id}`, as.zoneAuditor)).statusCode).toBe(200);
        // the auditor reads and does not act
        expect((await count(other?.id ?? '', as.zoneAuditor, { countedSantim: '0' })).statusCode).toBe(403);
    });

    it('lists the earlier days that are still open, for the approver, read only', async () => {
        const seen = await api.call('GET', '/api/v1/cashier-sessions?overdue=true', as.zoneFinance);
        expect(seen.statusCode, seen.body).toBe(200);
        const items = seen.json<{ items: { id: string; overdue: boolean }[] }>().items;
        expect(items.map((i) => i.id)).toContain(yesterdaySession);
        expect(items.every((i) => i.overdue)).toBe(true);
    });

    it('opens a session only at an office that collects cash, refused on record', async () => {
        const refused = await api.call('POST', '/api/v1/cashier-sessions', as.cashX, { openingFloatSantim: '0' });
        expect(refused.statusCode, refused.body).toBe(403);
        const [n] = await rows<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log where event_type = 'access.denied' and diff ->> 'reason' = 'no_till'`
        );
        expect(n?.n).toBeGreaterThanOrEqual(1);
    });
});

describe('the refusals are on record', () => {
    it('for a count decided by its own cashier, by a role the region does not name, and by another cashier', async () => {
        for (const reason of ['session_self_decision', 'session_not_approver', 'session_not_own_till']) {
            const [n] = await rows<{ n: number }>(
                `select count(*)::int as n from kernel.audit_log where event_type = 'access.denied' and diff ->> 'reason' = $1`,
                [reason]
            );
            expect(n?.n, reason).toBeGreaterThanOrEqual(1);
        }
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
        await asEarlierDays(async () => {
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
        });
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
