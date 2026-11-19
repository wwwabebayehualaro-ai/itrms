/**
 * The remittance (task 1.12d, ADR-0063 §5), on a real PostgreSQL 16. The office takes its closed cashier sessions up to a day to
 * the bank: the total is the receipts of those sessions less the reversals decided after a till was counted (negative lines
 * under the receipt's account; the deposit due is not reduced by them), with cash and bank slips, a shortage and a number from
 * the office's counter. Open and pending sessions are listed, not covered; a session is remitted once; two prepares at once give
 * one remittance. The database refuses lines that are not the receipts, sessions that are not closed or are on two remittances,
 * and any change but the deposit, recorded once for the amount due. Every write is audited; the isolation matrix.
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
    cashA: '0199f0a0-d000-7000-8000-00000000c511',
    cashB: '0199f0a0-d000-7000-8000-00000000c512',
    cashC: '0199f0a0-d000-7000-8000-00000000c513',
    cashD: '0199f0a0-d000-7000-8000-00000000c514',
    cashE: '0199f0a0-d000-7000-8000-00000000c515',
    cashF: '0199f0a0-d000-7000-8000-00000000c516',
    cashG: '0199f0a0-d000-7000-8000-00000000c519',
    cashH: '0199f0a0-d000-7000-8000-00000000c517',
    cashI: '0199f0a0-d000-7000-8000-00000000c518'
};
const WAITING = 'RS-05';
const NOTE = 'The till is one Birr short';

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
            { key: 'remit-demo', name: t('Remit demo'), document: feeRuleSchema.parse(RULE) }
        ])
    );
    const { rows } = await api.owner.query<{ id: string }>(
        `select v.id from fees.fee_rule_versions v join fees.fee_rules r on r.latest_version_id = v.id where r.key = 'remit-demo'`
    );
    const rule = rows[0]?.id ?? '';
    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key: 'remit-request',
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
        key: 'remit-waiting',
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
    counts: { id: string; state: string }[];
}
const todaySession = async (who: As) =>
    (await api.call('GET', '/api/v1/cashier-sessions/current', who)).json<{ today: Session[] }>().today[0];
const count = (id: string, who: As, body: object) =>
    api.call('POST', `/api/v1/cashier-sessions/${id}/counts`, who, body);
const decideCount = (countId: string, who: As, body: object) =>
    api.call('POST', `/api/v1/cashier-session-counts/${countId}/decision`, who, body);
/** The cashier's till of today counted as it should be: the session closes. */
async function closeTill(who: As, countedSantim: string) {
    const s = await todaySession(who);
    const done = await count(s?.id ?? '', who, { countedSantim });
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json<Session>().state).toBe('closed');
    return s?.id ?? '';
}
const reverse = async (receiptId: string, cashier: As) => {
    const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, cashier, {
        reason: 'The applicant paid the wrong office'
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const decided = await api.call(
        'POST',
        `/api/v1/receipt-reversals/${asked.json<{ id: string }>().id}/decision`,
        as.zoneFinance,
        { decision: 'approved' }
    );
    expect(decided.statusCode, decided.body).toBe(200);
};

interface Group {
    accountCode: string;
    mappedByDefault: boolean;
    receiptSantim: string;
    reversalSantim: string;
    totalSantim: string;
}
interface Remittance {
    id: string;
    number: string;
    state: string;
    periodFrom: string;
    periodTo: string;
    revenueTotalSantim: string;
    cashSantim: string;
    bankSlipSantim: string;
    reversalSantim: string;
    differenceSantim: string;
    depositDueSantim: string;
    sessionCount: number;
    demo: boolean;
    deposit: { reference: string } | null;
    sessions: { id: string }[];
    groups: Group[];
    lines: { kind: string; receiptId: string; amountSantim: string; accountCode: string; mappedByDefault: boolean }[];
}
interface Preview {
    blocked: string | null;
    lineCount: number;
    revenueTotalSantim: string;
    depositDueSantim: string;
    differenceSantim: string;
    sessions: { id: string }[];
    notYetClosed: { id: string; state: string }[];
}
const prepare = (who: As, through: string) => api.call('POST', '/api/v1/remittances', who, { through });
const preview = (who: As, through: string) => api.call('GET', `/api/v1/remittances/preview?through=${through}`, who);
const rows = async <T extends QueryResultRow>(query: string, params: unknown[] = []) =>
    (await api.owner.query<T>(query, params)).rows;

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

let today = '';
let yesterday = '';
let r1 = {} as Remittance;
let r2 = {} as Remittance;
let r3 = {} as Remittance;
const sessionOf = {} as Record<'A' | 'C' | 'G' | 'H', string>;
const receiptOf = {} as Record<'A1' | 'A2' | 'G1' | 'G2' | 'H', string>;

beforeAll(async () => {
    pg = await startPostgres();
    const cashiers = (['cashA', 'cashB', 'cashC', 'cashD', 'cashE', 'cashF', 'cashG', 'cashH', 'cashI'] as const).map(
        (k) => ({
            username: `test.remit.${k.toLowerCase()}`,
            sub: SUB[k],
            region: 'SER' as const,
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'cashier']] as [string, string][]
        })
    );
    api = await startApi(pg, [
        {
            username: 'test.bureau.fifth',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
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
        const home =
            k === 'bureau' || k === 'bureau2'
                ? units.ser
                : k === 'zoneFinance' || k === 'zoneAuditor'
                  ? units.zone
                  : units.boditi;
        as[k] = { sub: SUB[k], unit: home };
    }
    await setUpService();
    today =
        (await rows<{ d: string }>(`select (now() at time zone 'Africa/Addis_Ababa')::date::text as d`))[0]?.d ?? '';
    yesterday =
        (await rows<{ d: string }>(`select ((now() at time zone 'Africa/Addis_Ababa')::date - 1)::text as d`))[0]?.d ??
        '';
}, 240_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('preparing a remittance', () => {
    it('has nothing to remit before any till is closed', async () => {
        const none = await prepare(as.cashA, today);
        expect(none.statusCode, none.body).toBe(409);
        expect(none.json<{ code: string }>().code).toBe('invalid_transition');
        const looked = (await preview(as.cashA, today)).json<Preview>();
        expect(looked.sessions).toEqual([]);
        expect((await prepare(as.cashA, '2999-01-01')).statusCode).toBe(422);
    });

    it('covers the closed sessions: cash, a bank slip, a shortage; open and pending sessions are listed, not covered', async () => {
        // A: two cash receipts and a bank slip, counted right
        receiptOf.A1 = await paid(as.cashA);
        receiptOf.A2 = await paid(as.cashA);
        await paid(as.cashA, 'bank_slip');
        sessionOf.A = await closeTill(as.cashA, '80000');
        // B: a float of 50 Birr, one cash receipt, counted a Birr short and approved
        const opened = await api.call('POST', '/api/v1/cashier-sessions', as.cashB, { openingFloatSantim: '5000' });
        expect(opened.statusCode, opened.body).toBe(201);
        await paid(as.cashB);
        const sb = await todaySession(as.cashB);
        const short = await count(sb?.id ?? '', as.cashB, { countedSantim: '44000', note: NOTE });
        expect(short.statusCode, short.body).toBe(201);
        const approved = await decideCount(short.json<Session>().counts[0]?.id ?? '', as.zoneFinance, {
            decision: 'approve'
        });
        expect(approved.statusCode, approved.body).toBe(200);
        // C stays open, D waits for a decision
        await paid(as.cashC);
        sessionOf.C = (await todaySession(as.cashC))?.id ?? '';
        await paid(as.cashD);
        const sd = await todaySession(as.cashD);
        expect((await count(sd?.id ?? '', as.cashD, { countedSantim: '39000', note: NOTE })).statusCode).toBe(201);

        const looked = await preview(as.cashA, today);
        expect(looked.statusCode, looked.body).toBe(200);
        const p = looked.json<Preview>();
        expect(p.sessions).toHaveLength(2);
        expect(p.lineCount).toBe(4);
        expect(p.revenueTotalSantim).toBe('160000');
        // counted cash less the floats: 80000 + (44000 - 5000)
        expect(p.depositDueSantim).toBe('119000');
        expect(p.differenceSantim).toBe('-1000');
        expect(p.notYetClosed.map((s) => s.state).sort()).toEqual(['open', 'pending_approval']);
        // the look stored nothing
        expect((await rows<{ n: number }>('select count(*)::int as n from fees.remittances'))[0]?.n).toBe(0);

        const made = await prepare(as.cashA, today);
        expect(made.statusCode, made.body).toBe(201);
        r1 = made.json<Remittance>();
        expect(r1).toMatchObject({
            state: 'prepared',
            revenueTotalSantim: '160000',
            cashSantim: '120000',
            bankSlipSantim: '40000',
            reversalSantim: '0',
            differenceSantim: '-1000',
            depositDueSantim: '119000',
            sessionCount: 2,
            periodFrom: today,
            periodTo: today,
            demo: true
        });
        expect(r1.number).toMatch(/^WOL-BODITI\/RM\/00001\/\d{4}$/);
        // the placeholder account took every line, and says so
        expect(r1.groups).toHaveLength(1);
        expect(r1.groups[0]).toMatchObject({ mappedByDefault: true, totalSantim: '160000', reversalSantim: '0' });
        expect(r1.lines.filter((l) => l.kind === 'receipt')).toHaveLength(4);
        // the figures of each session are the frozen ones
        expect(r1.sessions.map((s) => s.id).sort()).toEqual([sessionOf.A, sb?.id ?? ''].sort());
        // the document is asked for through the outbox, in the same transaction
        const events = await rows<{ n: number }>(
            `select count(*)::int as n from kernel.outbox_events where type = 'remittance.prepared.v1' and payload ->> 'remittanceId' = $1`,
            [r1.id]
        );
        expect(events[0]?.n).toBe(1);
    });

    it('does not cover a session twice: a second prepare has nothing to remit, though others are open', async () => {
        const again = await prepare(as.cashA, today);
        expect(again.statusCode, again.body).toBe(409);
        expect(again.json<{ code: string }>().code).toBe('invalid_transition');
        const p = (await preview(as.cashA, today)).json<Preview>();
        expect(p.sessions).toEqual([]);
        expect(p.notYetClosed).toHaveLength(2);
    });

    it("never covers another office's session: the zone's remittance has nothing to remit", async () => {
        // Boditi has closed tills, the zone (its own office) none
        const zone = await prepare(as.zoneFinance, today);
        expect(zone.statusCode, zone.body).toBe(409);
        expect((await preview(as.zoneFinance, today)).json<Preview>().sessions).toEqual([]);
    });
});

describe('the bank deposit', () => {
    it('is recorded once, for the amount due, with a reference unique in the office', async () => {
        const wrong = await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.cashA, {
            bank: 'CBE',
            reference: 'ft 123 456',
            depositedOn: today,
            amountSantim: '120000'
        });
        expect(wrong.statusCode, wrong.body).toBe(409);
        expect(wrong.json<{ code: string }>().code).toBe('amount_mismatch');
        const body = { bank: 'CBE', reference: ' ft 123 456 ', depositedOn: today, amountSantim: '119000' };
        expect(
            (await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.cashA, { ...body, bank: 'NOBANK' }))
                .statusCode
        ).toBe(422);
        expect(
            (
                await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.cashA, {
                    ...body,
                    depositedOn: '2999-01-01'
                })
            ).statusCode
        ).toBe(422);
        // another office does not record the deposit of this one
        expect((await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.zoneFinance, body)).statusCode).toBe(
            403
        );
        const done = await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.cashA, body);
        expect(done.statusCode, done.body).toBe(200);
        expect(done.json<Remittance>()).toMatchObject({ state: 'deposited', deposit: { reference: 'ft 123 456' } });
        const again = await api.call('POST', `/api/v1/remittances/${r1.id}/deposit`, as.cashA, body);
        expect(again.statusCode, again.body).toBe(409);
        const [norm] = await rows<{ n: string }>(
            'select deposit_reference_norm as n from fees.remittances where id = $1',
            [r1.id]
        );
        expect(norm?.n).toBe('FT123456');
    });
});

describe('reversals decided after the till was counted', () => {
    it('are negative lines under the receipt’s account; the deposit due is unchanged; one whose receipt is not covered waits', async () => {
        // E: a receipt in a closed till, reversed afterwards (its receipt is covered by this remittance)
        const receiptE = await paid(as.cashE);
        await closeTill(as.cashE, '40000');
        await reverse(receiptE, as.cashE);
        // F: a closed till with a receipt, nothing reversed
        await paid(as.cashF);
        await closeTill(as.cashF, '40000');
        // A: a receipt of the first remittance, reversed afterwards: a negative line alone, under the account it was booked to
        await reverse(receiptOf.A1, as.cashA);
        const flags = await rows<{ after_till_closed: boolean }>(
            `select after_till_closed from fees.receipt_reversals where receipt_id = any($1::uuid[])`,
            [[receiptE, receiptOf.A1]]
        );
        expect(flags.every((f) => f.after_till_closed)).toBe(true);

        // up to yesterday nothing is covered: E's reversal waits for the remittance that covers its receipt, A's does not
        const early = (await preview(as.cashA, yesterday)).json<Preview>();
        expect(early.sessions).toEqual([]);
        expect(early.lineCount).toBe(1);
        expect((await prepare(as.cashA, yesterday)).statusCode).toBe(409);

        const looked = (await preview(as.cashA, today)).json<Preview>();
        expect(looked.sessions).toHaveLength(2);
        expect(looked.lineCount).toBe(4);
        const made = await prepare(as.cashA, today);
        expect(made.statusCode, made.body).toBe(201);
        r2 = made.json<Remittance>();
        expect(r2.number).toMatch(/^WOL-BODITI\/RM\/00002\/\d{4}$/);
        expect(r2).toMatchObject({
            revenueTotalSantim: '0',
            cashSantim: '80000',
            bankSlipSantim: '0',
            reversalSantim: '-80000',
            sessionCount: 2,
            differenceSantim: '0',
            // counted cash only: Finance makes the refunds
            depositDueSantim: '80000'
        });
        const reversals = r2.lines.filter((l) => l.kind === 'reversal');
        expect(reversals.map((l) => l.amountSantim)).toEqual(['-40000', '-40000']);
        const earlier = r1.lines.find((l) => l.receiptId === receiptOf.A1);
        expect(reversals.find((l) => l.receiptId === receiptOf.A1)?.accountCode).toBe(earlier?.accountCode);
        // the reversals are on one remittance only
        expect((await prepare(as.cashA, today)).statusCode).toBe(409);
    });

    it('lets the second remittance be deposited, but not under the first one’s reference', async () => {
        const body = { bank: 'CBE', depositedOn: today, amountSantim: '80000' };
        const taken = await api.call('POST', `/api/v1/remittances/${r2.id}/deposit`, as.cashA, {
            ...body,
            reference: 'FT123456'
        });
        expect(taken.statusCode, taken.body).toBe(409);
        expect(taken.json<{ code: string }>().code).toBe('duplicate_reference');
        // a different office could use the same slip number: the key is per office (not exercised here); a new number is accepted
        // after the tampering checks below, which need this remittance still prepared
    });
});

describe('what the database holds to, as the application role', () => {
    const remittanceRow = (id: string, n: number, over: Record<string, string | number> = {}) => {
        const v = {
            cash: 40000,
            revenue: 40000,
            due: 40000,
            diff: 0,
            ...over
        };
        return sql`insert into fees.remittances (id, region_id, handling_unit_id, number, fiscal_year, sequence, period_from, period_to,
                revenue_total_santim, cash_santim, bank_slip_santim, reversal_santim, difference_santim, deposit_due_santim, prepared_by, demo)
            values (${id}, ${units.boditi.regionId}, ${units.boditi.id}, ${`TAMPER/${n}`}, 2019, ${900 + n}, ${today}::date, ${today}::date,
                ${v.revenue}::bigint, ${v.cash}::bigint, 0, 0, ${v.diff}::bigint, ${v.due}::bigint, gen_random_uuid(), true)`;
    };
    const sessionRow = (remittance: string, session: string) =>
        sql`insert into fees.remittance_sessions (id, region_id, handling_unit_id, remittance_id, session_id)
            values (gen_random_uuid(), ${units.boditi.regionId}, ${units.boditi.id}, ${remittance}, ${session})`;
    const lineRow = (remittance: string, receipt: string, amount: number, position = 1) =>
        sql`insert into fees.remittance_lines (id, region_id, handling_unit_id, remittance_id, kind, receipt_id, order_line_position, line_key,
                account_code, budget_category, account_name, mapped_by_default, payment_method, amount_santim)
            values (gen_random_uuid(), ${units.boditi.regionId}, ${units.boditi.id}, ${remittance}, 'receipt', ${receipt}, ${position}, 'base',
                '0000', 'PLACEHOLDER', '{"am":"x","en":"x"}'::jsonb, true, 'cash', ${amount}::bigint)`;

    beforeAll(async () => {
        // H: a closed till not yet remitted, to tamper with
        receiptOf.H = await paid(as.cashH);
        sessionOf.H = await closeTill(as.cashH, '40000');
        // G: two receipts of one amount, one reversed before the till was counted (it is not in the frozen figures)
        receiptOf.G1 = await paid(as.cashG);
        receiptOf.G2 = await paid(as.cashG);
        await reverse(receiptOf.G2, as.cashG);
        sessionOf.G = await closeTill(as.cashG, '40000');
    });

    it('refuses a receipt reversed before the count swapped in for a valid one of the same amount', async () => {
        const id = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(id, 20));
                    await tx.execute(sessionRow(id, sessionOf.G));
                    await tx.execute(lineRow(id, receiptOf.G2, 40000));
                })
            )
        ).toMatch(/receipt line is of a payment|remittance_lines_receipt_of_session/);
    });

    it('refuses a line with a wrong amount, though the totals follow it', async () => {
        const id = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(id, 1, { cash: 39999, revenue: 39999 }));
                    await tx.execute(sessionRow(id, sessionOf.H));
                    await tx.execute(lineRow(id, receiptOf.H, 39999));
                })
            )
        ).toMatch(/receipt line is of a payment|remittance_lines_receipt_of_session|session_figures/);
    });

    it('refuses totals that are not the lines, a deposit due that is not the count, and a remittance without sessions', async () => {
        const a = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(a, 2, { cash: 50000, revenue: 50000 }));
                    await tx.execute(sessionRow(a, sessionOf.H));
                    await tx.execute(lineRow(a, receiptOf.H, 40000));
                })
            )
        ).toMatch(/totals are the sums|remittances_totals/);
        const b = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(b, 3, { due: 1 }));
                    await tx.execute(sessionRow(b, sessionOf.H));
                    await tx.execute(lineRow(b, receiptOf.H, 40000));
                })
            )
        ).toMatch(/deposit due|remittances_deposit_due/);
        expect(
            await refusal(asApp((tx) => tx.execute(remittanceRow(randomUUID(), 4, { cash: 0, revenue: 0, due: 1 }))))
        ).toMatch(/covers closed sessions|remittances_sessions/);
    });

    it('refuses a session that is not closed, a session on two remittances and a receipt on two', async () => {
        const open = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(open, 5));
                    await tx.execute(sessionRow(open, sessionOf.C));
                })
            )
        ).toMatch(/closed sessions of its own office|remittance_sessions_closed/);
        const twice = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(twice, 6));
                    await tx.execute(sessionRow(twice, sessionOf.A));
                })
            )
        ).toMatch(/remittance_sessions_session_uq|duplicate key/);
        const receiptTwice = randomUUID();
        expect(
            await refusal(
                asApp(async (tx) => {
                    await tx.execute(remittanceRow(receiptTwice, 7));
                    await tx.execute(sessionRow(receiptTwice, sessionOf.H));
                    await tx.execute(lineRow(receiptTwice, receiptOf.A2, 40000));
                })
            )
        ).toMatch(/remittance_lines_receipt_uq|duplicate key/);
        // nothing of the attempts is left
        expect(
            (
                await rows<{ n: number }>(
                    `select count(*)::int as n from fees.remittances where number like 'TAMPER/%'`
                )
            )[0]?.n
        ).toBe(0);
    });

    it('refuses a line written to a remittance after the transaction that made it, and any removal', async () => {
        expect(await refusal(asApp((tx) => tx.execute(lineRow(r1.id, receiptOf.H, 40000, 2))))).toMatch(
            /written with its remittance|remittance_parts_with_remittance/
        );
        expect(
            await refusal(
                asApp((tx) => tx.execute(sql`delete from fees.remittance_lines where remittance_id = ${r1.id}`))
            )
        ).toMatch(/permission denied/);
        expect(await refusal(asApp((tx) => tx.execute(sql`delete from fees.remittances where id = ${r1.id}`)))).toMatch(
            /permission denied/
        );
        expect(await refusal(asApp((tx) => tx.execute(sql`truncate fees.remittance_lines`)))).toMatch(
            /permission denied|append-only/
        );
    });

    it('refuses an update of the totals, a second deposit, and a deposit of another amount', async () => {
        expect(
            await refusal(
                asApp((tx) => tx.execute(sql`update fees.remittances set cash_santim = 1 where id = ${r1.id}`))
            )
        ).toMatch(/permission denied/);
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(
                        sql`update fees.remittances set deposit_reference = 'OTHER', deposit_reference_norm = 'OTHER' where id = ${r1.id}`
                    )
                )
            )
        ).toMatch(/only the deposit is recorded/);
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'XYZ123',
                        deposit_reference_norm = 'XYZ123', deposited_on = ${today}::date, deposited_amount_santim = 1,
                        deposited_by = gen_random_uuid(), deposited_at = now() where id = ${r2.id}`)
                )
            )
        ).toMatch(/remittances_deposit_check|deposit_check/);
        const [still] = await rows<{ state: string }>('select state from fees.remittances where id = $1', [r2.id]);
        expect(still?.state).toBe('prepared');
    });
});

describe('two prepares at once', () => {
    it('cover the session once: one remittance, the other has nothing to remit, and the numbers have no gap', async () => {
        const [a, b] = await Promise.all([prepare(as.cashH, today), prepare(as.cashI, today)]);
        expect([a.statusCode, b.statusCode].sort(), `${a.body} ${b.body}`).toEqual([201, 409]);
        const won = a.statusCode === 201 ? a : b;
        r3 = won.json<Remittance>();
        expect(r3.sessions.map((s) => s.id).sort()).toEqual([sessionOf.G, sessionOf.H].sort());
        expect(r3.depositDueSantim).toBe('80000');
        expect(r3.number).toMatch(/^WOL-BODITI\/RM\/00003\/\d{4}$/);
        const seq = await rows<{ sequence: string }>(
            'select sequence::text from fees.remittances where handling_unit_id = $1 order by sequence',
            [units.boditi.id]
        );
        expect(seq.map((s) => s.sequence)).toEqual(['1', '2', '3']);
        const per = await rows<{ n: number }>(
            'select count(*)::int as n from fees.remittance_sessions where session_id = $1',
            [sessionOf.H]
        );
        expect(per[0]?.n).toBe(1);
    });
});

describe('the deposit reference', () => {
    const cite = (id: string, over: Record<string, string>) =>
        api.call('POST', `/api/v1/remittances/${id}/deposit`, as.cashA, {
            bank: 'CBE',
            reference: 'FT0099',
            depositedOn: today,
            amountSantim: '80000',
            ...over
        });
    const cited = (unit: OrgUnit, bank: string, norm: string) =>
        asUnit(
            app,
            unit,
            async (tx) =>
                (
                    await tx.execute<{ c: string | null }>(
                        sql`select fees.deposit_reference_in_use(${bank}, ${norm}, gen_random_uuid()) as c`
                    )
                ).rows[0]?.c
        );

    it('is compared as a payment slip is: 00123 is 123, and cited once at a bank in the whole region', async () => {
        const first = await cite(r3.id, { reference: '00123', amountSantim: r3.depositDueSantim });
        expect(first.statusCode, first.body).toBe(200);
        const [norm] = await rows<{ n: string }>(
            'select deposit_reference_norm as n from fees.remittances where id = $1',
            [r3.id]
        );
        expect(norm?.n).toBe('123');
        const again = await cite(r2.id, { reference: ' 123 ' });
        expect(again.statusCode, again.body).toBe(409);
        expect(again.json<{ code: string }>().code).toBe('duplicate_reference');
        // another office of the region cannot cite the one slip either: the zone sees what Boditi's request cannot
        expect(await cited(units.zone, 'CBE', '123')).toBe('remittance');
        expect(await cited(units.zone, 'CBE', 'FT123456')).toBe('remittance');
        // the same number at another bank is another slip
        expect(await cited(units.zone, 'AWASH', 'FT123456')).toBeNull();
        expect(await cited(units.trx, 'CBE', '123')).toBeNull();
    });

    it("is refused when another office's remittance cites it", async () => {
        // a deposit of the zone's own, written as the table's owner (the zone's checks of sessions and lines are not the point)
        await api.owner.query('begin');
        try {
            await api.owner.query('alter table fees.remittances disable trigger remittances_sums');
            const id = randomUUID();
            await api.owner.query(
                `insert into fees.remittances (id, region_id, handling_unit_id, number, fiscal_year, sequence, period_from, period_to,
                    revenue_total_santim, cash_santim, bank_slip_santim, reversal_santim, difference_santim, deposit_due_santim, prepared_by, demo)
                 values ($1, $2, $3, 'ZONE/RM/1', 2019, 777, $4, $4, 1000, 1000, 0, 0, 0, 1000, gen_random_uuid(), true)`,
                [id, units.zone.regionId, units.zone.id, today]
            );
            await api.owner.query(
                `update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'ZN-555',
                    deposit_reference_norm = 'ZN555', deposited_on = $2, deposited_amount_santim = 1000,
                    deposited_by = gen_random_uuid(), deposited_at = now() where id = $1`,
                [id, today]
            );
            await api.owner.query('alter table fees.remittances enable trigger remittances_sums');
            await api.owner.query('commit');
        } catch (error) {
            await api.owner.query('rollback');
            throw error;
        }
        const taken = await cite(r2.id, { reference: 'zn 555' });
        expect(taken.statusCode, taken.body).toBe(409);
        expect(taken.json<{ code: string }>().code).toBe('duplicate_reference');
        // the database says it too, whatever the service does
        const sql1 = sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'ZN 555',
            deposit_reference_norm = 'ZN555', deposited_on = ${today}::date, deposited_amount_santim = deposit_due_santim,
            deposited_by = gen_random_uuid(), deposited_at = now() where id = ${r2.id}`;
        expect(await refusal(asApp((tx) => tx.execute(sql1)))).toMatch(
            /cited on another remittance|deposit_reference_uq/
        );
    });

    it("is refused when it is a customer's payment slip, in the service and in the database", async () => {
        const slip = await pay(await order(), as.cashI, 'bank_slip');
        expect(slip.statusCode, slip.body).toBe(201);
        const [row] = await rows<{ r: string }>(
            `select slip_reference_norm as r from fees.payments where method = 'bank_slip' order by created_at desc limit 1`
        );
        expect(row?.r).toBeTruthy();
        const refused = await cite(r2.id, { reference: `00${row?.r?.toLowerCase()}` });
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json<{ code: string }>().code).toBe('duplicate_reference');
        expect(await cited(units.boditi, 'CBE', row?.r ?? '')).toBe('payment_slip');
        const sql2 = sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = ${row?.r},
            deposit_reference_norm = ${row?.r}, deposited_on = ${today}::date, deposited_amount_santim = deposit_due_santim,
            deposited_by = gen_random_uuid(), deposited_at = now() where id = ${r2.id}`;
        expect(await refusal(asApp((tx) => tx.execute(sql2)))).toMatch(/customer payment|deposit_is_payment_slip/);
    });

    it('is dated on or after the last day covered, and not after today', async () => {
        const before = await cite(r2.id, { reference: 'FT0098', depositedOn: yesterday });
        expect(before.statusCode, before.body).toBe(422);
        expect(before.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('depositedOn');
        const sql3 = sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'FT0098',
            deposit_reference_norm = 'FT0098', deposited_on = ${yesterday}::date, deposited_amount_santim = deposit_due_santim,
            deposited_by = gen_random_uuid(), deposited_at = now() where id = ${r2.id}`;
        expect(await refusal(asApp((tx) => tx.execute(sql3)))).toMatch(
            /remittances_deposited_on_check|deposited_on_check/
        );
        const sql4 = sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'FT0097',
            deposit_reference_norm = 'FT0097', deposited_on = (${today}::date + 1), deposited_amount_santim = deposit_due_santim,
            deposited_by = gen_random_uuid(), deposited_at = now() where id = ${r2.id}`;
        expect(await refusal(asApp((tx) => tx.execute(sql4)))).toMatch(/not dated after today|deposited_on_future/);
    });
});

describe('who reads, prepares and deposits', () => {
    it('lets the auditor and the head read and not act, and the second remittance be deposited', async () => {
        for (const who of [as.zoneAuditor, as.boditiHead]) {
            const seen = await api.call('GET', `/api/v1/remittances/${r1.id}`, who);
            expect(seen.statusCode, seen.body).toBe(200);
            expect(seen.json<Remittance>().lines.length).toBeGreaterThan(0);
            expect((await api.call('GET', '/api/v1/remittances', who)).statusCode).toBe(200);
            expect((await prepare(who, today)).statusCode).toBe(403);
            expect(
                (
                    await api.call('POST', `/api/v1/remittances/${r2.id}/deposit`, who, {
                        bank: 'CBE',
                        reference: 'NOPE123',
                        depositedOn: today,
                        amountSantim: '80000'
                    })
                ).statusCode
            ).toBe(403);
        }
        const listed = (await api.call('GET', '/api/v1/remittances?state=deposited', as.cashA)).json<{
            items: Remittance[];
        }>();
        expect(listed.items.map((r) => r.id).sort()).toEqual([r1.id, r3.id].sort());
        const done = await api.call('POST', `/api/v1/remittances/${r2.id}/deposit`, as.zoneFinance, {
            bank: 'CBE',
            reference: 'FT777888',
            depositedOn: today,
            amountSantim: '80000'
        });
        // the zone's finance officer acts for the zone, not for the office whose remittance this is
        expect(done.statusCode).toBe(403);
        // the number the first remittance cited at CBE is another slip at another bank
        const own = await api.call('POST', `/api/v1/remittances/${r2.id}/deposit`, as.cashA, {
            bank: 'AWASH',
            reference: 'FT123456',
            depositedOn: today,
            amountSantim: '80000'
        });
        expect(own.statusCode, own.body).toBe(200);
    });
});

describe('nothing to deposit, and an amount below zero', () => {
    it('settles at once a remittance of bank-slip money only: no deposit is recorded for it', async () => {
        const opened = await api.call('POST', '/api/v1/cashier-sessions', as.cashF, { openingFloatSantim: '5000' });
        expect(opened.statusCode, opened.body).toBe(201);
        await paid(as.cashF, 'bank_slip');
        await closeTill(as.cashF, '5000');
        const looked = (await preview(as.cashF, today)).json<Preview>();
        expect(looked).toMatchObject({ depositDueSantim: '0', blocked: null });
        const made = await prepare(as.cashF, today);
        expect(made.statusCode, made.body).toBe(201);
        const settled = made.json<Remittance>();
        expect(settled).toMatchObject({
            state: 'settled',
            depositDueSantim: '0',
            cashSantim: '0',
            bankSlipSantim: '40000'
        });
        expect(settled.number).toMatch(/^WOL-BODITI\/RM\/00004\/\d{4}$/);
        const deposit = await api.call('POST', `/api/v1/remittances/${settled.id}/deposit`, as.cashF, {
            bank: 'CBE',
            reference: 'FT555111',
            depositedOn: today,
            amountSantim: '0'
        });
        expect(deposit.statusCode, deposit.body).toBe(409);
        expect(deposit.json<{ code: string }>().code).toBe('invalid_transition');
        // the database: no move out of settled, and settled is exactly a zero amount due
        expect(
            await refusal(
                asApp((tx) =>
                    tx.execute(sql`update fees.remittances set state = 'deposited', deposit_bank = 'CBE', deposit_reference = 'FT555111',
                        deposit_reference_norm = 'FT555111', deposited_on = ${today}::date, deposited_amount_santim = 0,
                        deposited_by = gen_random_uuid(), deposited_at = now() where id = ${settled.id}`)
                )
            )
        ).toMatch(/only the deposit is recorded|settled_check|deposit_check/);
        const insert = (n: number, state: string, due: number) =>
            sql`insert into fees.remittances (id, region_id, handling_unit_id, number, fiscal_year, sequence, period_from, period_to, state,
                    revenue_total_santim, cash_santim, bank_slip_santim, reversal_santim, difference_santim, deposit_due_santim, prepared_by, demo)
                values (gen_random_uuid(), ${units.boditi.regionId}, ${units.boditi.id}, ${`SETTLED/${n}`}, 2019, ${800 + n}, ${today}::date, ${today}::date,
                    ${state}, ${due}::bigint, ${due}::bigint, 0, 0, 0, ${due}::bigint, gen_random_uuid(), true)`;
        expect(await refusal(asApp((tx) => tx.execute(insert(1, 'settled', 1000))))).toMatch(
            /remittances_settled_check|settled_check/
        );
        expect(await refusal(asApp((tx) => tx.execute(insert(2, 'prepared', 0))))).toMatch(
            /remittances_settled_check|settled_check/
        );
    });

    it('blocks a prepare whose amount to deposit is below zero, and says so in the preview', async () => {
        // a float of 50 Birr, bank-slip money only, counted nothing: counted less the float is -50 Birr
        const opened = await api.call('POST', '/api/v1/cashier-sessions', as.cashE, { openingFloatSantim: '5000' });
        expect(opened.statusCode, opened.body).toBe(201);
        await paid(as.cashE, 'bank_slip');
        const s = await todaySession(as.cashE);
        const short = await count(s?.id ?? '', as.cashE, { countedSantim: '0', note: NOTE });
        expect(short.statusCode, short.body).toBe(201);
        const approved = await decideCount(short.json<Session>().counts[0]?.id ?? '', as.zoneFinance, {
            decision: 'approve'
        });
        expect(approved.statusCode, approved.body).toBe(200);
        const looked = (await preview(as.cashE, today)).json<Preview>();
        expect(looked).toMatchObject({ depositDueSantim: '-5000', blocked: 'negative_due' });
        const refused = await prepare(as.cashE, today);
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json<{ code: string }>().code).toBe('invalid_transition');
    });
});

describe('the audit', () => {
    it('has a row for every write of a remittance, its sessions, its lines and its deposit', async () => {
        const tables = await rows<{ t: string; a: string }>(
            `select distinct table_name as t, action as a from kernel.audit_log
              where table_name in ('fees.remittances', 'fees.remittance_sessions', 'fees.remittance_lines')`
        );
        expect(tables.map((r) => `${r.t}:${r.a}`).sort()).toEqual([
            'fees.remittance_lines:insert',
            'fees.remittance_sessions:insert',
            'fees.remittances:insert',
            'fees.remittances:update'
        ]);
        const [n] = await rows<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log where table_name = 'fees.remittance_lines' and action = 'insert'`
        );
        const [lines] = await rows<{ n: number }>('select count(*)::int as n from fees.remittance_lines');
        expect(n?.n).toBe(lines?.n);
        const [denied] = await rows<{ n: number }>(
            `select count(*)::int as n from kernel.audit_log where event_type = 'access.denied' and diff ->> 'reason' = 'remittance_other_office'`
        );
        expect(denied?.n).toBeGreaterThanOrEqual(1);
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
    const numberOf = (c: IsolationCase) => `ISO-${c}`;

    beforeAll(async () => {
        // rows at each office, written as the table's owner with the checks of a real remittance off (they need real receipts
        // and covered sessions); switched back on before the commit. Sessions of earlier days, as the sessions' matrix writes them
        const [receipt] = await rows<{ id: string }>('select id from fees.receipts limit 1');
        await api.owner.query('begin');
        try {
            await api.owner.query('alter table fees.cashier_sessions disable trigger cashier_sessions_opens_open');
            await api.owner.query('alter table fees.remittances disable trigger remittances_sums');
            await api.owner.query('alter table fees.remittance_sessions disable trigger remittance_sessions_guard');
            await api.owner.query('alter table fees.remittance_lines disable trigger remittance_lines_guard');
            await api.owner.query('alter table fees.remittance_lines disable trigger remittance_lines_sums');
            await api.owner.query('alter table fees.remittance_sessions disable trigger remittance_sessions_sums');
            let position = 0;
            for (const c of ISOLATION_CASES) {
                position += 1;
                const unit = CASE_UNITS[c]();
                const session = randomUUID();
                const remittance = randomUUID();
                await api.owner.query(
                    `insert into fees.cashier_sessions (id, region_id, handling_unit_id, cashier_id, business_day, opened_via)
                     values ($1, $2, $3, gen_random_uuid(), $4, 'explicit')`,
                    [session, unit.regionId, unit.id, `2026-0${position}-01`]
                );
                await api.owner.query(
                    `insert into fees.remittances (id, region_id, handling_unit_id, number, fiscal_year, sequence, period_from, period_to,
                        revenue_total_santim, cash_santim, bank_slip_santim, reversal_santim, difference_santim, deposit_due_santim, prepared_by, demo, state)
                     values ($1, $2, $3, $4, 2019, $5, '2026-01-01', '2026-01-01', 0, 0, 0, 0, 0, 0, gen_random_uuid(), true, 'settled')`,
                    [remittance, unit.regionId, unit.id, numberOf(c), 500 + position]
                );
                await api.owner.query(
                    `insert into fees.remittance_sessions (id, region_id, handling_unit_id, remittance_id, session_id)
                     values (gen_random_uuid(), $1, $2, $3, $4)`,
                    [unit.regionId, unit.id, remittance, session]
                );
                await api.owner.query(
                    `insert into fees.remittance_lines (id, region_id, handling_unit_id, remittance_id, kind, receipt_id, order_line_position,
                        line_key, account_code, budget_category, account_name, mapped_by_default, payment_method, amount_santim)
                     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4, $5, 'iso', '0', 'X', '{"am":"x","en":"x"}', true, 'cash', 1)`,
                    [unit.regionId, unit.id, remittance, receipt?.id, 100 + position]
                );
            }
            await api.owner.query('alter table fees.remittance_lines enable trigger remittance_lines_guard');
            await api.owner.query('alter table fees.remittance_lines enable trigger remittance_lines_sums');
            await api.owner.query('alter table fees.remittance_sessions enable trigger remittance_sessions_sums');
            await api.owner.query('alter table fees.remittance_sessions enable trigger remittance_sessions_guard');
            await api.owner.query('alter table fees.remittances enable trigger remittances_sums');
            await api.owner.query('alter table fees.cashier_sessions enable trigger cashier_sessions_opens_open');
            await api.owner.query('commit');
        } catch (error) {
            await api.owner.query('rollback');
            throw error;
        }
    }, 120_000);

    const caseOf = (number: string) => ISOLATION_CASES.find((c) => numberOf(c) === number);

    it.each([
        ['fees.remittances', `select number from fees.remittances where number like 'ISO-%'`],
        [
            'fees.remittance_sessions',
            `select r.number from fees.remittance_sessions s join fees.remittances r on r.id = s.remittance_id where r.number like 'ISO-%'`
        ],
        [
            'fees.remittance_lines',
            `select r.number from fees.remittance_lines l join fees.remittances r on r.id = l.remittance_id where r.number like 'ISO-%'`
        ]
    ] as const)('shows the acting unit exactly the rows of %s its class allows', async (_table, query) => {
        const seen = await asUnit(app, units.zone, async (tx) =>
            (await tx.execute<{ number: string }>(sql.raw(query))).rows.map((r) => caseOf(r.number))
        );
        expect([...new Set(seen)].sort()).toEqual([...VISIBLE.transaction].sort());
    });

    it.each(['fees.remittances', 'fees.remittance_sessions', 'fees.remittance_lines'])(
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
