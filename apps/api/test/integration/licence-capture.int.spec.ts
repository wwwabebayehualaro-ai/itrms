/**
 * The back-capture of a paper driver licence (MIG-02, ADR-0054, ADR-0051 §4, task 1.6b) as it is seeded, run end to end through the API
 * on a real PostgreSQL 16 with the Wolaita seeds: a clerk at Boditi captures a paper licence with the number and the card serial printed
 * on it and its scan; the licence is not on the register until a second person verifies the capture against the paper, and the one who
 * captured it cannot. It is then active, marked as migrated, with no national reference. A printed number inside the range the region
 * reserved for ITRMS, or one another licence carries, never joins the register and is never renumbered: the second person flags it to
 * the bureau, which reads it from above. Numbers, serials, references and names are generated.
 */
import { randomInt, randomUUID } from 'node:crypto';

import {
    importLicenceCaptureService,
    importLicenceGrades,
    licenceCaptureFlow,
    setUpLicenceCounters
} from '@itrms/competency/seed';
import type { Licence } from '@itrms/competency/contracts';
import type { OrgUnit } from '@itrms/kernel/org';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { setLicenceNumbering } from './support/licences';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    clerk: '0199f0a0-d000-7000-8000-00000000b601',
    verifier: '0199f0a0-d000-7000-8000-00000000b602',
    zoneLead: '0199f0a0-d000-7000-8000-00000000b603',
    damot: '0199f0a0-d000-7000-8000-00000000b604'
};
const SERVICE = 'MIG-02';
/** The region reserves 06-50000 onwards for the numbers ITRMS gives (a placeholder range, Z). */
const FIRST_NUMBER = 50_000;

let pg: TestPostgres;
let api: TestApi;
let boditi: OrgUnit;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

let serial = 0;
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

/** A paper number outside the reserved range, and one inside it. */
const paperNumber = () => `06-${String(randomInt(1000, FIRST_NUMBER - 1)).padStart(5, '0')}`;
const reservedNumber = () => `06-${String(randomInt(FIRST_NUMBER, 99_999))}`;
const cardSerial = () => `ሀ-${String(randomInt(100000, 999999))}`;
const paperReference = () => `BOD/DL/${String(randomInt(1, 999999)).padStart(6, '0')}`;

async function registered(): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', as.clerk, {
        nameAm: { given: 'አሽከርካሪ', father: `ወረቀት${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ታደሰ' },
        nameEn: { given: 'Sample', father: `Driver${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'male',
        birthYear: 1985,
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

/** A scan the clerk uploaded: stored, at Boditi. */
async function scan(): Promise<string> {
    const id = randomUUID();
    await api.owner.query(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
             confirmed_at, origin, created_by)
         values ($1, $2, $3, 'stored', 'paper-licence.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
        [id, boditi.regionId, boditi.id, `files/${boditi.regionId}/${id}`, await api.userId(SUB.clerk)]
    );
    return id;
}

/** A paper licence as the clerk types it: a permanent automobile licence issued in 2021, valid to 2025. */
const capture = async (over: Record<string, unknown> = {}): Promise<Record<string, unknown>> => ({
    paperReference: paperReference(),
    paperFileScan: [{ file_id: await scan() }],
    person: await registered(),
    number: paperNumber(),
    cardSerial: cardSerial(),
    kind: 'permanent',
    issuedOn: '2021-07-15',
    validUntil: '2025-07-14',
    issuedBy: 'Wolaita Zone',
    grades: [{ grade: 'automobile', permanentSince: '2019-03-01' }],
    ...over
});

const file = (answers: Record<string, unknown>, who: As = as.clerk) =>
    api.call('POST', '/api/v1/service-requests', who, { serviceCode: SERVICE, answers });

async function filed(answers: Record<string, unknown>): Promise<CaseOut> {
    const res = await file(answers);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<CaseOut>();
}

const step = (c: CaseOut, who: As, body: object) =>
    api.call('POST', `/api/v1/cases/${c.id}/transitions`, who, body, ifMatch(c.version));

async function moved(c: CaseOut, who: As, action: string, more: object = {}): Promise<CaseOut> {
    const res = await step(c, who, { action, ...more });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}

async function submitted(answers: Record<string, unknown>): Promise<CaseOut> {
    const c = await moved(await filed(answers), as.clerk, 'submit');
    expect(c.state).toBe('verification');
    return c;
}

const byNumber = async (number: string, who: As = as.clerk): Promise<Licence[]> =>
    (await api.call('GET', `/api/v1/competency/licences?number=${encodeURIComponent(number)}`, who)).json<{
        items: Licence[];
    }>().items;

const flagsSeenBy = async (who: As) => {
    const res = await api.call('GET', '/api/v1/competency/licence-number-flags', who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ items: { number: string; reason: string; caseId: string; paperReference: string }[] }>().items;
};

const refusedAt = async (answers: Record<string, unknown>) => {
    const started = await file(answers);
    expect(started.statusCode, started.body).toBe(201);
    const res = await step(started.json<CaseOut>(), as.clerk, { action: 'submit' });
    return { status: res.statusCode, body: res.json<{ errors?: { path: string; code: string }[] }>() };
};

const counter = async () =>
    (
        await api.owner.query<{ last: string }>(
            `select c.last_value::text as last from kernel.number_counters c join kernel.org_units u on u.id = c.unit_id
              where c.key = 'competency.licence' and u.parent_id is null and u.region_id = $1`,
            [boditi.regionId]
        )
    ).rows[0]?.last;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.mig2.clerk',
            sub: SUB.clerk,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.mig2.verifier',
            sub: SUB.verifier,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.officer']]
        },
        {
            username: 'test.mig2.zone.lead',
            sub: SUB.zoneLead,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.lead']]
        },
        {
            username: 'test.mig2.damot',
            sub: SUB.damot,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'competency.officer']]
        }
    ]);
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.clerk = { sub: SUB.clerk, unit: boditi };
    as.verifier = { sub: SUB.verifier, unit: boditi };
    as.zoneLead = { sub: SUB.zoneLead, unit: await api.unit('SER', 'WOL') };
    as.damot = { sub: SUB.damot, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

    const root = { id: region.id, regionId: region.regionId };
    await setLicenceNumbering(api, root, { scope: 'region', regionCode: '06', firstNumber: FIRST_NUMBER });
    await api.installer.scoped({}, async (tx) => {
        await importLicenceGrades(tx, root);
        await setUpLicenceCounters(tx, root.regionId);
        expect(await importLicenceCaptureService(tx, root)).toBe(1);
    });
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('what is seeded', () => {
    it('stays as it is when seeded again, and passes the checks a bureau’s own workflow would meet', async () => {
        const region = await api.unit('SER', 'SER');
        expect(
            await api.installer.scoped({}, (tx) =>
                importLicenceCaptureService(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
        const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-licence-capture',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: licenceCaptureFlow()
        });
        expect(flow.statusCode, flow.body).toBe(201);
    });
});

describe('a paper licence’s capture', () => {
    it('joins the register only after another person verifies it, as printed, migrated and without a national reference', async () => {
        const answers = await capture();
        const number = String(answers.number);
        const c = await submitted(answers);
        expect(c.notices).toEqual([]);
        // not on the register while it waits for its second person
        expect(await byNumber(number)).toEqual([]);
        // the one who captured it cannot verify it (separation of duties, SEC-AC-6)
        const own = await step(c, as.clerk, { action: 'verify' });
        expect(own.statusCode, own.body).toBe(403);
        expect(await byNumber(number)).toEqual([]);

        const verified = await step(c, as.verifier, { action: 'verify' });
        expect(verified.statusCode, verified.body).toBe(200);
        expect(verified.json<CaseOut>().state).toBe('captured');
        const [licence] = await byNumber(number);
        expect(licence).toMatchObject({
            number,
            cardSerial: String(answers.cardSerial).toUpperCase(),
            status: 'active',
            kind: 'permanent',
            issuedOn: '2021-07-15',
            validUntil: '2025-07-14',
            nationalReference: null,
            personId: answers.person,
            grades: [expect.objectContaining({ key: 'automobile', permanentSince: '2019-03-01' })],
            migration: {
                source: 'back_capture',
                paperReference: answers.paperReference,
                issuedBy: 'Wolaita Zone',
                caseId: c.id,
                verifiedBy: await api.userId(SUB.verifier)
            }
        });
        // read across the region (class R), as any licence: another office finds it by its number
        expect((await byNumber(number, as.damot)).map((l) => l.id)).toEqual([licence?.id]);
        // the licence and its grade on record, in the verifying request's transaction
        const audited = await api.owner.query<{ line: string }>(
            `select table_name || ':' || action as line from kernel.audit_log
              where request_id = $1 and table_name in ('competency.driver_licences', 'competency.licence_grades')
              order by 1`,
            [verified.headers['x-request-id']]
        );
        expect(audited.rows.map((r) => r.line)).toEqual([
            'competency.driver_licences:insert',
            'competency.licence_grades:insert'
        ]);
        // the regional counter never moved: a captured licence keeps the number printed on it
        expect(await counter()).toBe(String(FIRST_NUMBER - 1));
    }, 120_000);

    it('is refused at filing for what the paper cannot say', async () => {
        const cases: [Record<string, unknown>, string][] = [
            [{ number: '06 01234 !' }, 'number'],
            [{ cardSerial: 'BAD SERIAL!' }, 'cardSerial'],
            [{ issuedOn: '2999-01-01', validUntil: '2999-02-01' }, 'issuedOn'],
            [{ validUntil: '2020-01-01' }, 'validUntil'],
            [{ grades: [{ grade: 'automobile' }, { grade: 'automobile' }] }, 'grades.1.grade'],
            [{ kind: 'forever' }, 'kind']
        ];
        for (const [over, path] of cases) {
            const { status, body } = await refusedAt(await capture(over));
            expect(status, JSON.stringify(body)).toBe(422);
            expect(body.errors?.map((e) => e.path)).toContain(path);
        }
    }, 120_000);

    it('is refused for a person who holds a licence already, and for a card serial another licence carries', async () => {
        const first = await capture();
        await moved(await submitted(first), as.verifier, 'verify');
        const samePerson = await refusedAt(await capture({ person: first.person }));
        expect(samePerson.status).toBe(422);
        expect(samePerson.body.errors?.map((e) => e.path)).toContain('person');
        const sameSerial = await refusedAt(await capture({ cardSerial: first.cardSerial }));
        expect(sameSerial.status).toBe(422);
        expect(sameSerial.body.errors?.map((e) => e.path)).toContain('cardSerial');
    }, 120_000);

    it('keeps a number inside the region’s reserved range off the register: refused, flagged to the bureau, never renumbered', async () => {
        const before = await counter();
        const answers = await capture({ number: reservedNumber() });
        const number = String(answers.number);
        const c = await submitted(answers);
        // everyone acting on the case is told why
        expect(c.notices).toEqual(['competency.licenceCapture.numberConflict']);
        const verify = await step(c, as.verifier, { action: 'verify' });
        expect(verify.statusCode, verify.body).toBe(409);
        // the flag says why, and is for the second person: never the one who captured it
        expect((await step(c, as.clerk, { action: 'flag', comment: 'Inside the reserved range.' })).statusCode).toBe(
            403
        );
        const flagging = await step(c, as.verifier, { action: 'flag', comment: 'Inside the reserved range.' });
        expect(flagging.statusCode, flagging.body).toBe(200);
        expect(flagging.json<CaseOut>().state).toBe('flagged');
        expect(await byNumber(number)).toEqual([]);
        expect(await counter()).toBe(before);
        // the flag on record, in the flagging request's transaction; no licence written
        const audited = await api.owner.query<{ line: string }>(
            `select table_name || ':' || action as line from kernel.audit_log
              where request_id = $1 and table_name like 'competency.%'
              order by 1`,
            [flagging.headers['x-request-id']]
        );
        expect(audited.rows.map((r) => r.line)).toEqual(['competency.licence_number_flags:insert']);

        // the bureau reads it from above; another office of the zone does not
        for (const who of [as.zoneLead, as.verifier])
            expect(await flagsSeenBy(who)).toContainEqual(
                expect.objectContaining({ number, reason: 'in_regional_range', caseId: c.id })
            );
        expect((await flagsSeenBy(as.damot)).map((f) => f.number)).not.toContain(number);
    }, 120_000);

    it('flags a number another licence of the region carries', async () => {
        const first = await capture();
        await moved(await submitted(first), as.verifier, 'verify');
        const c = await submitted(await capture({ number: first.number }));
        expect(c.notices).toEqual(['competency.licenceCapture.numberConflict']);
        expect((await step(c, as.verifier, { action: 'verify' })).statusCode).toBe(409);
        await moved(c, as.verifier, 'flag', { comment: 'Another licence carries this number.' });
        expect(await flagsSeenBy(as.verifier)).toContainEqual(
            expect.objectContaining({ number: first.number, reason: 'number_taken', caseId: c.id })
        );
        // still the one licence
        expect(await byNumber(String(first.number))).toHaveLength(1);
    }, 120_000);

    it('is never flagged when its number can be kept, and verified twice makes one licence', async () => {
        const answers = await capture();
        const c = await submitted(answers);
        const flag = await step(c, as.verifier, { action: 'flag', comment: 'No reason at all.' });
        expect(flag.statusCode, flag.body).toBe(409);
        await moved(c, as.verifier, 'verify');
        // the same step again is refused by the case (it has moved on): still one licence
        expect((await step(c, as.verifier, { action: 'verify' })).statusCode).toBeGreaterThanOrEqual(400);
        expect(await byNumber(String(answers.number))).toHaveLength(1);
    }, 120_000);

    it('gives one person one licence when two captures of them, with different numbers, are verified at the same moment', async () => {
        const first = await capture();
        const second = await capture({ person: first.person });
        // both filed before either joins the register, so both pass the filing's check
        const [a, b] = [await submitted(first), await submitted(second)];
        const results = await Promise.all([
            step(a, as.verifier, { action: 'verify' }),
            step(b, as.verifier, { action: 'verify' })
        ]);
        const codes = results.map((r) => r.statusCode).sort();
        expect(codes[0], results.map((r) => r.body).join('\n')).toBe(200);
        expect([409, 422]).toContain(codes[1]);
        const held = await api.owner.query<{ n: string }>(
            `select count(*) as n from competency.driver_licences where person_id = $1 and status <> 'voided'`,
            [first.person]
        );
        expect(held.rows[0]?.n).toBe('1');
    }, 120_000);
});
