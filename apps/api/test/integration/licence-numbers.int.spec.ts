/**
 * The driver licence family, part 1 (task 1.6, ADR-0051, ADR-0052, ADR-0064): the regional licence number, taken in the worker when
 * the national platform accepts, from one counter on the region's root unit; and the blood group, recorded by a register command into
 * a field-encrypted table and read in clear only through the audited reveal by the competency lead of the handling subtree.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LicencesService } from '@itrms/competency/api';
import { askNationalPlatform, type NationalDeps } from '@itrms/competency/api/worker';
import type { Licence } from '@itrms/competency/contracts';
import { importLicenceGrades, importLicenceServices, setUpLicenceCounters } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { FakeNationalDriverPlatform } from '@itrms/integrations/api';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { OrgUnit } from '@itrms/kernel/org';
import { asUnit, ISOLATION_CASES, TEST_CONTEXT_KEY, VISIBLE, WRITABLE } from '@itrms/kernel/testing';
import { CasesService } from '@itrms/workflow/api';
import type { CaseOut } from '@itrms/workflow/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { setLicenceNumbering, setRegionSetting } from './support/licences';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    officer: '0199f0a0-d000-7000-8000-00000000e602',
    examiner: '0199f0a0-d000-7000-8000-00000000e603',
    lead: '0199f0a0-d000-7000-8000-00000000e604',
    trxClerk: '0199f0a0-d000-7000-8000-00000000e605',
    // the demo's own (apps/api/seed/users/wolaita.demo.yaml)
    zoneLead: '0199f0a0-d000-7000-8000-000000000103',
    cashier: '0199f0a0-d000-7000-8000-000000000303'
};
const NEW = 'DVC-03';
const SETTING = 'competency.card_shows_blood_group';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let system: SystemDatabase;
let deps: NationalDeps;
let licences: LicencesService;
let school: string;
let region: OrgUnit;
let zone: OrgUnit;
let boditi: OrgUnit;
let areka: OrgUnit;
let tzb: OrgUnit;
let tzbW1: OrgUnit;
let trx: OrgUnit;
let holder: string;
let trxHolder: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

let serial = 0;
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

async function registered(who: As = as.officer): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', who, {
        nameAm: { given: 'ቁጥር', father: `ባለቤት${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ተሰማ' },
        nameEn: { given: 'Number', father: `Holder${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'female',
        birthYear: Number(today().slice(0, 4)) - 30,
        sensitive: { birthDate: `${Number(today().slice(0, 4)) - 30}${today().slice(4)}` },
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

async function trained(person: string): Promise<void> {
    const enrolled = await api.call('POST', '/api/v1/competency/training-enrolments', as.officer, {
        personId: person,
        schoolId: school,
        grade: 'automobile'
    });
    expect(enrolled.statusCode, enrolled.body).toBe(201);
    const { id, version } = enrolled.json<{ id: string; version: number }>();
    const done = await api.call(
        'POST',
        `/api/v1/competency/training-enrolments/${id}/completion`,
        as.officer,
        { completedOn: today() },
        ifMatch(version)
    );
    expect(done.statusCode, done.body).toBeLessThan(300);
}

const application = (person: string) => ({
    person,
    grade: 'automobile',
    educationGrade: 10,
    school,
    medicalFacility: 'Sample Health Centre',
    medicalExaminedOn: today()
});

async function filed(person: string): Promise<CaseOut> {
    const answers = application(person);
    const shown = await api.call('POST', '/api/v1/fees/preview', as.officer, { serviceCode: NEW, answers });
    expect(shown.statusCode, shown.body).toBe(200);
    const fee = shown.json<{ feeRuleVersionId: string; totalSantim: string }>();
    const started = await api.call('POST', '/api/v1/service-requests', as.officer, {
        serviceCode: NEW,
        answers,
        fee: { ruleVersionId: fee.feeRuleVersionId, totalSantim: fee.totalSantim }
    });
    expect(started.statusCode, started.body).toBe(201);
    return started.json<CaseOut>();
}

const step = (c: CaseOut, who: As, body: object) =>
    api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));

async function moved(c: CaseOut, who: As, action: string, more: object = {}): Promise<CaseOut> {
    const res = await step(c, who, { action, ...more });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}

const caseOf = async (id: string) => (await api.call('GET', `/api/v1/cases/${id}`, as.officer)).json<CaseOut>();

async function paid(c: CaseOut): Promise<void> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, as.cashier);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        as.cashier,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Applicant' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
}

/** A new licence through its whole case, accepted by the platform: what the region's counter numbers. */
async function issuedThroughItsCase(): Promise<Licence> {
    const person = await registered();
    await trained(person);
    let c = await filed(person);
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    c = await moved(c, as.examiner, 'pass', { answers: { heldOn: today(), theory: 80, practical: 75, passed: true } });
    await paid(c);
    c = await moved(await caseOf(c.id), as.lead, 'approve');
    expect(c.state).toBe('national');
    const [pending] = (await api.call('GET', `/api/v1/competency/licences?personId=${person}`, as.officer)).json<{
        items: Licence[];
    }>().items;
    expect(await askNationalPlatform(system, deps, { caseId: c.id, licenceId: pending?.id ?? '', kind: 'new' })).toBe(
        'accepted'
    );
    expect((await caseOf(c.id)).state).toBe('issued');
    const res = await api.call('GET', `/api/v1/competency/licences/${pending?.id ?? ''}`, as.officer);
    return res.json<Licence>();
}

/** A licence waiting for the national platform at an office, written as the owner (its case has its own spec). */
async function pendingAt(unit: OrgUnit, person = holder): Promise<string> {
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into competency.driver_licences (id, region_id, handling_unit_id, person_id)
         values (gen_random_uuid(), $1, $2, $3) returning id`,
        [unit.regionId, unit.id, person]
    );
    return rows[0]?.id ?? '';
}

/** The platform's acceptance as the worker applies it: one system transaction, as the case's event would run it. */
const activated = (licenceId: string, unit: OrgUnit, answer: object = { reference: `REF-${licenceId}` }) =>
    system.systemContext('test.activate', (tx) =>
        licences.activate(
            tx,
            { caseId: randomUUID(), regionId: unit.regionId, handlingUnitId: unit.id, ctx: { requestId: 'test' } },
            { licence: { id: licenceId } },
            answer
        )
    );

const counter = async (unit: OrgUnit) =>
    (
        await api.owner.query<{ last_value: string; pattern: string }>(
            `select last_value::text, pattern from kernel.number_counters where unit_id = $1 and key = 'competency.licence'`,
            [unit.id]
        )
    ).rows[0];

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.num.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.num.examiner',
            sub: SUB.examiner,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.examiner']]
        },
        {
            username: 'test.num.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.num.trx',
            sub: SUB.trxClerk,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    boditi = await api.unit('SER', 'WOL-BODITI');
    areka = await api.unit('SER', 'WOL-AREKA');
    tzb = await api.unit('SER', 'TZB');
    tzbW1 = await api.unit('SER', 'TZB-W1');
    trx = await api.unit('TRX', 'TRX-W1');
    as.officer = { sub: SUB.officer, unit: boditi };
    as.examiner = { sub: SUB.examiner, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.cashier = { sub: SUB.cashier, unit: boditi };
    as.zoneLead = { sub: SUB.zoneLead, unit: zone };
    as.trxClerk = { sub: SUB.trxClerk, unit: trx };

    const root = { id: region.id, regionId: region.regionId };
    await setLicenceNumbering(api, root);
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importLicenceGrades(tx, root);
        await importDocumentTemplates(tx, root);
        await setUpLicenceCounters(tx, root.regionId);
        await importLicenceServices(tx, root);
    });
    licences = api.http.get(LicencesService);
    deps = { platform: new FakeNationalDriverPlatform(), licences, cases: api.http.get(CasesService) };
    const made = await api.call('POST', '/api/v1/organisations', as.officer, {
        kind: 'training_school',
        name: { am: 'ናሙና ማሰልጠኛ', en: `Sample Driving School ${randomInt(1000, 9999)}` }
    });
    expect(made.statusCode, made.body).toBe(201);
    school = made.json<{ id: string }>().id;
    holder = await registered();
    trxHolder = await registered(as.trxClerk);
}, 240_000);

afterAll(async () => {
    await app?.close();
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('the regional licence number (ADR-0051)', () => {
    it('is set up on the region’s root from its code and first number, and refused without them', async () => {
        expect(await counter(region)).toEqual({ last_value: '0', pattern: '06-{seq:05}' });
        // the offices keep their own, for scope `unit`
        expect(await counter(boditi)).toEqual({ last_value: '0', pattern: '{unit}/DL/{seq:06}' });
        const trxRoot = await api.unit('TRX', 'TRX');
        await expect(api.installer.scoped({}, (tx) => setUpLicenceCounters(tx, trxRoot.regionId))).rejects.toThrow(
            /regionCode and firstNumber/
        );
        // as `seed competency` runs it: told, the counter left unmade, the transaction (and the rest of the seed) goes on
        const told: string[] = [];
        await api.installer.scoped({}, (tx) =>
            setUpLicenceCounters(tx, trxRoot.regionId, { onUnset: (problem) => told.push(problem) })
        );
        expect(told).toEqual([expect.stringMatching(/regionCode and firstNumber/)]);
        expect(await counter(trxRoot)).toBeUndefined();
    });

    it('numbers licences across two offices from one sequence, and the offices’ own counters stay', async () => {
        const first = await issuedThroughItsCase();
        expect(first).toMatchObject({ status: 'active', number: '06-00001', handlingUnit: { id: boditi.id } });
        const atZone = await pendingAt(zone);
        expect(await activated(atZone, zone)).toEqual({ licence: { id: atZone, number: '06-00002' } });
        expect((await counter(region))?.last_value).toBe('2');
        expect((await counter(boditi))?.last_value).toBe('0');
        expect((await counter(zone))?.last_value).toBe('0');
    }, 240_000);

    it('takes the national platform’s number when it gives one, and then no counter moves', async () => {
        const before = (await counter(region))?.last_value;
        const id = await pendingAt(boditi);
        expect(await activated(id, boditi, { reference: 'NAT-1', licenceNumber: 'ETH-DL-000777' })).toEqual({
            licence: { id, number: 'ETH-DL-000777' }
        });
        expect((await counter(region))?.last_value).toBe(before);
    });

    it('gives twenty licences accepted at once across offices twenty consecutive numbers, none twice or skipped', async () => {
        const start = Number((await counter(region))?.last_value);
        const offices = [boditi, zone];
        const pending = await Promise.all(
            Array.from({ length: 20 }, (_, i) => {
                const unit = offices[i % 2] ?? boditi;
                return pendingAt(unit).then((id) => ({ id, unit }));
            })
        );
        // each in its own system transaction, as the worker delivers them
        const given = await Promise.all(pending.map(({ id, unit }) => activated(id, unit)));
        const numbers = given.map((g) => g.licence.number).sort();
        expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => `06-${String(start + i + 1).padStart(5, '0')}`));
        expect(new Set(numbers).size).toBe(20);
        expect((await counter(region))?.last_value).toBe(String(start + 20));
    }, 120_000);

    it('gives a number back when its activation rolls back', async () => {
        const before = Number((await counter(region))?.last_value);
        const id = await pendingAt(boditi);
        await expect(
            system.systemContext('test.activate', async (tx) => {
                await licences.activate(
                    tx,
                    { caseId: randomUUID(), regionId: boditi.regionId, handlingUnitId: boditi.id, ctx: {} },
                    { licence: { id } },
                    { reference: 'R' }
                );
                throw new Error('the step after it failed');
            })
        ).rejects.toThrow(/the step after it failed/);
        expect(Number((await counter(region))?.last_value)).toBe(before);
        const again = await activated(id, boditi);
        expect(again.licence.number).toBe(`06-${String(before + 1).padStart(5, '0')}`);
    });

    it('numbers per office in scope `unit`, and leaves the regional counter', async () => {
        const root = { id: region.id, regionId: region.regionId };
        const before = (await counter(region))?.last_value;
        await setLicenceNumbering(api, root, { scope: 'unit' });
        try {
            const id = await pendingAt(boditi);
            expect((await activated(id, boditi)).licence.number).toBe('WOL-BODITI/DL/000001');
            expect((await counter(region))?.last_value).toBe(before);
        } finally {
            await setLicenceNumbering(api, root);
        }
    });

    it('refuses a filing (409) while the region has no counter, and a licence already numbered keeps its number', async () => {
        const saved = await counter(region);
        const person = await registered();
        await trained(person);
        const c = await filed(person);
        await api.owner.query(`delete from kernel.number_counters where unit_id = $1 and key = 'competency.licence'`, [
            region.id
        ]);
        try {
            const res = await step(c, as.officer, { action: 'submit' });
            expect(res.statusCode, res.body).toBe(409);
            expect(res.json()).toMatchObject({ code: 'not_configured' });
        } finally {
            await api.owner.query(
                `insert into kernel.number_counters (id, region_id, unit_id, key, pattern, last_value)
                 values (gen_random_uuid(), $1, $2, 'competency.licence', $3, $4)`,
                [region.regionId, region.id, saved?.pattern, saved?.last_value]
            );
        }
        expect((await moved(await caseOf(c.id), as.officer, 'submit')).state).toBe('review');
        // set up again (a new first number below the issued ones): nothing issued is issued again
        await api.installer.scoped({}, (tx) => setUpLicenceCounters(tx, region.regionId));
        expect((await counter(region))?.last_value).toBe(saved?.last_value);
    }, 240_000);

    it('answers the filing’s question only for the licence counter, and only for the caller’s region', async () => {
        const ready = (unit: OrgUnit, key: string) =>
            asUnit(app, unit, async (tx) => {
                const { rows } = await tx.execute<{ ready: boolean }>(
                    sql`select kernel.regional_counter_ready(${key}) as ready`
                );
                return rows[0]?.ready;
            });
        expect(await ready(boditi, 'competency.licence')).toBe(true);
        expect(await ready(boditi, 'fees.receipt')).toBe(false);
        // Test Region X has no regional licence counter, whatever Wolaita's region has
        expect(await ready(trx, 'competency.licence')).toBe(false);
        // and nothing without a context
        const none = await app.scoped({}, (tx) =>
            tx.execute<{ ready: boolean }>(sql`select kernel.regional_counter_ready('competency.licence') as ready`)
        );
        expect(none.rows[0]?.ready).toBe(false);
    });
});

describe('the blood group (ADR-0052)', () => {
    let licenceId = '';
    let arekaLicence = '';
    const record = (who: As, id: string, bloodGroup: string) =>
        api.call('POST', `/api/v1/competency/licences/${id}/health`, who, { bloodGroup });
    const reveal = (who: As, id: string, reason = 'checking the card before it is handed over') =>
        api.call('POST', `/api/v1/competency/licences/${id}/health/reveal`, who, { reason });
    const events = async (id: string) =>
        (
            await api.owner.query<{ actor_id: string; diff: { fields: string[]; reason: string } }>(
                `select actor_id, diff from kernel.audit_log where event_type = 'licence.health_revealed' and row_id = $1
                  order by at, id`,
                [id]
            )
        ).rows;
    const denied = async () =>
        (
            await api.owner.query<{ n: number }>(
                `select count(*)::int as n from kernel.audit_log where event_type = 'access.denied'
                  and diff->>'permission' = 'licence-health:reveal'`
            )
        ).rows[0]?.n ?? 0;

    beforeAll(async () => {
        licenceId = await pendingAt(boditi);
        await activated(licenceId, boditi);
        arekaLicence = await pendingAt(areka);
        await activated(arekaLicence, areka);
    });

    it('is not collected while the region has not turned it on (409)', async () => {
        const res = await record(as.officer, licenceId, 'AB-');
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json()).toMatchObject({ code: 'not_configured' });
        expect(
            (await api.owner.query('select 1 from competency.licence_health where licence_id = $1', [licenceId]))
                .rowCount
        ).toBe(0);
    });

    it('is recorded encrypted, audited in the same transaction without its value, and shown only as on record', async () => {
        await setRegionSetting(api, { id: region.id, regionId: region.regionId }, SETTING, true);
        const res = await record(as.officer, licenceId, 'AB-');
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json<Licence>()).toMatchObject({
            id: licenceId,
            bloodGroupOnRecord: true,
            bloodGroupCollected: true
        });
        expect(res.body).not.toContain('AB-');

        // at rest: a ciphertext only (the owner's own pool reads the table as it is)
        const { rows } = await api.owner.query<{ ct: Buffer; same_tx: boolean; diff: unknown }>(
            `select h.blood_group_ct as ct, h.xmin::text = a.xmin::text as same_tx, a.diff
               from competency.licence_health h
               join kernel.audit_log a on a.table_name = 'competency.licence_health' and a.row_id = h.id
              where h.licence_id = $1`,
            [licenceId]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.ct.toString('utf8')).not.toContain('AB-');
        expect(rows[0]?.ct.length).toBeGreaterThan(16);
        expect(rows[0]?.same_tx).toBe(true);
        expect(JSON.stringify(rows[0]?.diff)).not.toMatch(/AB-|bloodGroupCt|blood_group_ct/);

        // corrected: an audited update, still without the value
        const again = await record(as.lead, licenceId, 'O+');
        expect(again.statusCode, again.body).toBe(200);
        const audit = await api.owner.query<{ action: string; diff: unknown }>(
            `select a.action, a.diff from kernel.audit_log a join competency.licence_health h on h.id = a.row_id
              where a.table_name = 'competency.licence_health' and h.licence_id = $1 order by a.at, a.id`,
            [licenceId]
        );
        expect(audit.rows.map((r) => r.action)).toEqual(['insert', 'update']);
        expect(JSON.stringify(audit.rows)).not.toMatch(/O\+|AB-/);

        // the register, its search and the lookup say only that one is on record
        for (const url of [
            `/api/v1/competency/licences/${licenceId}`,
            `/api/v1/competency/licences?status=active&limit=100`
        ]) {
            const read = await api.call('GET', url, as.officer);
            expect(read.statusCode, read.body).toBe(200);
            expect(read.body).toContain('"bloodGroupOnRecord":true');
            expect(read.body).not.toMatch(/O\+|AB-|bloodGroup"/);
        }
        // never a value outside the list of groups
        expect((await record(as.officer, licenceId, 'Z+')).statusCode).toBe(422);
    });

    it('is refused to anyone but the lead: an officer gets 403, on record', async () => {
        const before = await denied();
        const res = await reveal(as.officer, licenceId);
        expect(res.statusCode).toBe(403);
        expect(await denied()).toBe(before + 1);
    });

    it('asks the lead for a recent second factor and a reason', async () => {
        const stale = await reveal({ ...as.lead, authAge: 900 }, licenceId);
        expect(stale.statusCode).toBe(401);
        expect(stale.json()).toMatchObject({ code: 'step_up_required' });
        expect((await reveal(as.lead, licenceId, 'x')).statusCode).toBe(422);
        expect(await events(licenceId)).toEqual([]);
    });

    it('shows the lead of the handling office the value, and records who asked why', async () => {
        const res = await reveal(as.lead, licenceId);
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toEqual({ bloodGroup: 'O+' });
        // never kept for replay
        expect(res.headers['idempotent-replayed']).toBeUndefined();
        const [event] = await events(licenceId);
        expect(event?.actor_id).toBe(await api.userId(SUB.lead));
        expect(event?.diff).toEqual({ fields: ['bloodGroup'], reason: 'checking the card before it is handed over' });
    });

    it('is not found for a lead of another office, though the attempt is on record', async () => {
        // Areka's licence: the zone's lead records it, Boditi's (a sibling) cannot read it
        expect((await record(as.zoneLead, arekaLicence, 'B+')).statusCode).toBe(200);
        expect((await record(as.officer, arekaLicence, 'A+')).statusCode).toBe(404);
        const res = await reveal(as.lead, arekaLicence);
        expect(res.statusCode).toBe(404);
        expect(await events(arekaLicence)).toHaveLength(1);
        const zoneRead = await reveal(as.zoneLead, arekaLicence);
        expect(zoneRead.statusCode, zoneRead.body).toBe(200);
        expect(zoneRead.json()).toEqual({ bloodGroup: 'B+' });
        expect(await events(arekaLicence)).toHaveLength(2);
    });

    it('cannot be opened on another licence’s row: the ciphertext is bound to its own', async () => {
        const other = await pendingAt(boditi);
        await activated(other, boditi);
        expect((await record(as.officer, other, 'A-')).statusCode).toBe(200);
        await api.owner.query(
            `update competency.licence_health set blood_group_ct = (select blood_group_ct from competency.licence_health
              where licence_id = $2) where licence_id = $1`,
            [other, licenceId]
        );
        const res = await reveal(as.lead, other);
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        // recorded although the read failed
        expect(await events(other)).toHaveLength(1);
    });
});

describe('the isolation matrix of licence_health (class R at the handling office)', () => {
    const CASE_UNITS = () => ({
        own: zone,
        child: boditi,
        parent: region,
        sibling: tzb,
        otherZone: tzbW1,
        otherRegion: trx
    });
    const rows: Record<string, string> = {};

    beforeAll(async () => {
        for (const c of ISOLATION_CASES) {
            const unit = CASE_UNITS()[c];
            const licence = await pendingAt(unit, unit.regionId === trx.regionId ? trxHolder : holder);
            const { rows: made } = await api.owner.query<{ id: string }>(
                `insert into competency.licence_health (id, region_id, handling_unit_id, licence_id, blood_group_ct)
                 values (gen_random_uuid(), $1, $2, $3, $4) returning id`,
                [unit.regionId, unit.id, licence, randomBytes(48)]
            );
            rows[made[0]?.id ?? ''] = c;
        }
    }, 120_000);

    it('shows the acting unit exactly the rows its class allows', async () => {
        const seen = await asUnit(app, zone, async (tx) =>
            (await tx.execute<{ id: string }>(sql`select id from competency.licence_health`)).rows
                .map((r) => rows[r.id])
                .filter((c): c is string => c !== undefined)
        );
        expect([...new Set(seen)].sort()).toEqual([...VISIBLE.registry].sort());
    });

    it.each(ISOLATION_CASES)('lets the acting unit change the %s row only where class R allows it', async (c) => {
        const id = Object.keys(rows).find((k) => rows[k] === c) ?? '';
        const changed = await asUnit(app, zone, (tx) =>
            tx.execute(sql`update competency.licence_health set updated_at = now() where id = ${id}`)
        );
        expect(changed.rowCount).toBe(WRITABLE.registry.includes(c) ? 1 : 0);
    });

    it('lets nobody delete one', async () => {
        const id = Object.keys(rows).find((k) => rows[k] === 'own') ?? '';
        const refused = await asUnit(app, zone, (tx) =>
            tx.execute(sql`delete from competency.licence_health where id = ${id}`)
        ).then(
            () => 'deleted',
            (error: { cause?: { message?: string }; message: string }) => error.cause?.message ?? error.message
        );
        expect(refused).toMatch(/permission denied/);
    });

    it('shows nothing without a context, on a connection that has just served one', async () => {
        const one = createDatabase(pg.url('app'), { max: 1, contextKey: TEST_CONTEXT_KEY });
        try {
            await asUnit(one, zone, (tx) => tx.execute(sql`select count(*) from competency.licence_health`));
            const seen = await one.scoped({}, (tx) =>
                tx.execute<{ n: string }>(sql`select count(*) as n from competency.licence_health`)
            );
            expect(seen.rows[0]?.n).toBe('0');
        } finally {
            await one.close();
        }
    });
});
