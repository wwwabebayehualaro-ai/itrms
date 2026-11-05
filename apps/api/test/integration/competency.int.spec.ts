/**
 * Driver licences (task 0.24a): the effects, against a real database, on workflows made for these tests (the real services come in
 * 0.24b). An application is refused by the rules; an approved one waits for the national platform, reached through the outbox, and
 * only its answer makes a licence. The fake platform is the one the contract tests hold to the port.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { LicencesService } from '@itrms/competency/api';
import { askNationalPlatform, sendPrintBatch, type NationalDeps } from '@itrms/competency/api/worker';
import {
    COMPETENCY_EFFECTS as E,
    NATIONAL_ACCEPTED,
    NATIONAL_ACTOR,
    NATIONAL_REJECTED
} from '@itrms/competency/contracts';
import type { Licence } from '@itrms/competency/contracts';
import { importLicenceGrades, setUpLicenceCounters } from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { FakeNationalDriverPlatform } from '@itrms/integrations/api';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { CasesService } from '@itrms/workflow/api';
import type { CaseOut } from '@itrms/workflow/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000d501',
    officer: '0199f0a0-d000-7000-8000-00000000d502',
    examiner: '0199f0a0-d000-7000-8000-00000000d503',
    lead: '0199f0a0-d000-7000-8000-00000000d504',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};
const NEW = 'DVC-03';
const RENEW = 'DVC-04';

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let deps: NationalDeps;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const t = (en: string) => ({ am: en, en });

const field = (id: string, type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: t(id),
    classification: 'personal',
    props: { required: true, ...props },
    behavior: { validation: { supported: true } },
    ...extra
});

const MEDICAL = [field('medicalFacility', 'InputText'), field('medicalExaminedOn', 'EthDate')];

const NEW_FORM = {
    schemaVersion: 2,
    fields: [
        field('person', 'RegistryLookup', { provider: 'person' }),
        field(
            'grade',
            'Dropdown',
            {},
            {
                data: {
                    dataSource: {
                        staticData: [
                            { label: t('Automobile'), value: 'automobile' },
                            { label: t('Truck I'), value: 'truck-1' },
                            { label: t('Taxi'), value: 'taxi' }
                        ]
                    }
                }
            }
        ),
        field('educationGrade', 'InputNumber'),
        field('school', 'RegistryLookup', { provider: 'training-school' }),
        ...MEDICAL
    ]
};
const RENEW_FORM = {
    schemaVersion: 2,
    fields: [field('licence', 'RegistryLookup', { provider: 'driver-licence' }), ...MEDICAL]
};

const EXAM_FORM = {
    schemaVersion: 2,
    fields: [
        field('heldOn', 'EthDate'),
        field('theory', 'InputNumber', { required: false }),
        field('practical', 'InputNumber', { required: false }),
        field('passed', 'Checkbox')
    ]
};

const state = (key: string, role: string) => ({
    key,
    kind: 'task',
    label: t(key),
    assignee: { role, unit: 'handling' }
});
const NATIONAL_WAYS = (accepted: string[]) => [
    { from: 'national', to: 'issued', on: NATIONAL_ACCEPTED, actor: NATIONAL_ACTOR, effects: accepted },
    { from: 'national', to: 'approval', on: NATIONAL_REJECTED, actor: NATIONAL_ACTOR, effects: [E.voidPendingLicence] },
    { from: 'national', to: 'approval', on: 'timeout' }
];
const ENDS = [
    { key: 'national', kind: 'wait', label: t('National'), sla: { businessDays: 2 } },
    { key: 'issued', kind: 'end', label: t('Issued') }
];
const NEW_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        state('review', 'competency.officer'),
        { ...state('exam', 'competency.examiner'), stepForm: 'test-exam@1' },
        state('approval', 'competency.lead'),
        ...ENDS
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [E.checkApplication] },
        { from: 'review', to: 'exam', action: 'approve' },
        { from: 'exam', to: 'approval', action: 'pass', effects: [`${E.recordExam}:passed`] },
        { from: 'approval', to: 'national', action: 'approve', effects: [E.createPendingLicence] },
        ...NATIONAL_WAYS([E.activateLicence, E.issueLicenceCard, E.addToPrintBatch])
    ]
};
const RENEW_FLOW = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: t('Draft') },
        state('review', 'competency.officer'),
        { ...state('field_exam', 'competency.examiner'), stepForm: 'test-exam@1' },
        state('approval', 'competency.lead'),
        ...ENDS
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [E.checkRenewal] },
        {
            from: 'review',
            to: 'field_exam',
            action: 'approve',
            guard: { fact: 'renewal.lateOverYear', op: 'eq', value: true }
        },
        {
            from: 'review',
            to: 'approval',
            action: 'approve',
            guard: { fact: 'renewal.lateOverYear', op: 'eq', value: false }
        },
        { from: 'field_exam', to: 'approval', action: 'pass', effects: [`${E.recordExam}:passed`] },
        { from: 'approval', to: 'national', action: 'approve', effects: [E.requestRenewal] },
        ...NATIONAL_WAYS([E.renewLicence, E.issueLicenceCard, E.addToPrintBatch])
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

async function publishService(code: string, key: string, definition: object, form: string) {
    const wf = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, { key, name: t(key), definition });
    expect(wf.statusCode, wf.body).toBe(201);
    const published = await api.call('POST', `/api/v1/services/${code}/versions`, as.bureau, {
        workflowVersionId: wf.json<{ latestVersion: { id: string } }>().latestVersion.id,
        formVersionId: form,
        overridePolicy: {}
    });
    expect(published.statusCode, published.body).toBe(201);
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const yearsAgo = (years: number) => `${Number(today().slice(0, 4)) - years}${today().slice(4)}`;

let personSerial = 0;
// letters that don't fold into one another in the search (ሰ and ሠ are one letter there)
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
/** Names may hold letters only, and two people with one name would be a possible duplicate. */
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');
async function registered(birthDate: string | null): Promise<string> {
    personSerial += 1;
    const res = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'አበበ', father: `ከበደ${lettersOf(personSerial, ETHIOPIC)}`, grandfather: 'ተሰማ' },
        nameEn: { given: 'Generated', father: `Holder${lettersOf(personSerial, LATIN)}`, grandfather: 'Person' },
        sex: 'male',
        ...(birthDate ? { birthYear: Number(birthDate.slice(0, 4)), sensitive: { birthDate } } : {}),
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

let school: string;
async function trained(person: string, grade = 'automobile'): Promise<void> {
    const enrolled = await api.call('POST', '/api/v1/competency/training-enrolments', as.officer, {
        personId: person,
        schoolId: school,
        grade
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

const applicationOf = (person: string, over: Record<string, unknown> = {}) => ({
    person,
    grade: 'automobile',
    educationGrade: 10,
    school,
    medicalFacility: 'Sample Health Centre',
    medicalExaminedOn: today(),
    ...over
});

async function filed(code: string, answers: Record<string, unknown>): Promise<CaseOut> {
    const started = await api.call('POST', '/api/v1/service-requests', as.officer, { serviceCode: code, answers });
    expect(started.statusCode, started.body).toBe(201);
    return started.json<CaseOut>();
}

const step = (c: CaseOut, who: As, action: string, answers?: object) =>
    api.call(
        'POST',
        `/api/v1/cases/${c.id}/transitions`,
        who,
        { action, ...(answers ? { answers } : {}) },
        ifMatch(c.version)
    );

async function moved(c: CaseOut, who: As, action: string, answers?: object): Promise<CaseOut> {
    const res = await step(c, who, action, answers);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}

const EXAM = { heldOn: today(), theory: 80, practical: 75, passed: true };

/** A new-licence case at the point where the national platform has been asked. */
async function atNational(person: string): Promise<CaseOut> {
    await trained(person);
    let c = await filed(NEW, applicationOf(person));
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    c = await moved(c, as.examiner, 'pass', EXAM);
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('national');
    return c;
}

const licenceOf = async (person: string): Promise<Licence[]> => {
    const res = await api.call('GET', `/api/v1/competency/licences?personId=${person}`, as.officer);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ items: Licence[] }>().items;
};
const caseOf = async (id: string) => (await api.call('GET', `/api/v1/cases/${id}`, as.officer)).json<CaseOut>();
const factsOf = async (id: string) =>
    (await api.owner.query<{ facts: Record<string, unknown> }>('select facts from workflow.cases where id = $1', [id]))
        .rows[0]?.facts ?? {};
const count = async (sql: string, params: unknown[] = []) =>
    (await api.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

/** A person with an active licence, through the whole service. */
async function licensed(birthDate: string): Promise<{ person: string; licence: Licence }> {
    const person = await registered(birthDate);
    const c = await atNational(person);
    const licenceId = (await licenceOf(person))[0]?.id ?? '';
    await askNationalPlatform(system, deps, { caseId: c.id, licenceId, kind: 'new' });
    const [licence] = await licenceOf(person);
    if (!licence) throw new Error('no licence');
    return { person, licence };
}

beforeAll(async () => {
    pg = await startPostgres();
    const bureau = ['SER', 'bureau_admin'] as [string, string];
    api = await startApi(pg, [
        { username: 'test.bureau.comp', sub: SUB.bureau2, region: 'SER', home: 'SER', roles: [bureau] },
        {
            username: 'test.comp.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.comp.examiner',
            sub: SUB.examiner,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.examiner']]
        },
        {
            username: 'test.comp.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.examiner = { sub: SUB.examiner, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.damotRecords = { sub: SUB.damotRecords, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

    await api.installer.scoped({}, async (tx) => {
        const root = { id: region.id, regionId: region.regionId };
        await importLicenceGrades(tx, root);
        await importDocumentTemplates(tx, root);
        expect(await setUpLicenceCounters(tx, root.regionId)).toBeGreaterThan(0);
    });
    deps = {
        platform: new FakeNationalDriverPlatform(),
        licences: api.http.get(LicencesService),
        cases: api.http.get(CasesService)
    };
    await publishedForm('test-exam', EXAM_FORM);
    await publishService(NEW, 'test-new-licence', NEW_FLOW, await publishedForm('test-new-licence', NEW_FORM));
    await publishService(RENEW, 'test-renewal', RENEW_FLOW, await publishedForm('test-renewal', RENEW_FORM));
    const made = await api.call('POST', '/api/v1/organisations', as.officer, {
        kind: 'training_school',
        name: { am: 'ናሙና ማሰልጠኛ', en: `Sample Driving School ${randomInt(1000, 9999)}` }
    });
    expect(made.statusCode, made.body).toBe(201);
    school = made.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('the catalogue of grades', () => {
    it('is seeded from Art. 12, once', async () => {
        const res = await api.call('GET', '/api/v1/competency/grades', as.officer);
        expect(res.statusCode, res.body).toBe(200);
        const { items } = res.json<{ items: { key: string; minAge: number | null; prerequisites: string[] }[] }>();
        expect(items).toHaveLength(13);
        expect(items.find((g) => g.key === 'truck-2')).toMatchObject({ minAge: 24, prerequisites: ['truck-1'] });
        const region = await api.unit('SER', 'SER');
        const again = await api.installer.scoped({}, (tx) =>
            importLicenceGrades(tx, { id: region.id, regionId: region.regionId })
        );
        expect(again).toBe(0);
    });
});

describe('an application', () => {
    const refused = async (person: string, over: Record<string, unknown> = {}) => {
        const c = await filed(NEW, applicationOf(person, over));
        const res = await step(c, as.officer, 'submit');
        expect(res.statusCode, res.body).toBe(422);
        expect((await caseOf(c.id)).state).toBe('draft');
        return res.json<{ code: string; detail: string }>();
    };

    it('is refused under age, with a clear message in the person’s language', async () => {
        const person = await registered(yearsAgo(17));
        await trained(person);
        const problem = await refused(person);
        expect(problem.code).toBe('not_eligible');
        // the catalogue's Amharic, for a person working in Amharic
        expect(problem.detail).toContain('18');
    });

    it('is refused for a grade above the applicant’s age and education', async () => {
        const person = await registered(yearsAgo(19));
        await trained(person, 'truck-1');
        const { detail } = await refused(person, { grade: 'truck-1', educationGrade: 8 });
        expect(detail).toContain('22');
        expect(detail).toContain('10');
    });

    it('is refused without an exact date of birth: it isn’t guessed from the year', async () => {
        const person = await registered(null);
        await trained(person);
        expect((await refused(person)).code).toBe('not_eligible');
    });

    it('is refused with an old medical examination', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        await refused(person, { medicalExaminedOn: yearsAgo(1) });
    });

    it('is refused until the school has confirmed the training', async () => {
        const person = await registered(yearsAgo(30));
        await refused(person);
        const enrolled = await api.call('POST', '/api/v1/competency/training-enrolments', as.officer, {
            personId: person,
            schoolId: school,
            grade: 'automobile'
        });
        expect(enrolled.statusCode, enrolled.body).toBe(201);
        // enrolled is not finished
        await refused(person);
    });

    it('takes a school only if it is one', async () => {
        const person = await registered(yearsAgo(30));
        const other = await api.call('POST', '/api/v1/organisations', as.officer, {
            kind: 'garage',
            name: { am: 'ጋራጅ', en: `Sample Garage ${randomInt(1000, 9999)}` }
        });
        const res = await api.call('POST', '/api/v1/competency/training-enrolments', as.officer, {
            personId: person,
            schoolId: other.json<{ id: string }>().id,
            grade: 'automobile'
        });
        expect(res.statusCode, res.body).toBe(409);
    });

    it('stays on record as a use of the birth date when it is refused: a refusal tells something of an age', async () => {
        const person = await registered(yearsAgo(17));
        await trained(person);
        await refused(person);
        expect(
            await count(
                `select count(*)::int as n from kernel.audit_log where event_type = 'person.revealed' and row_id = $1`,
                [person]
            )
        ).toBeGreaterThanOrEqual(1);
    });

    it('is refused for a grade the person already holds, or is waiting for', async () => {
        const person = await registered(yearsAgo(30));
        await atNational(person);
        expect((await refused(person)).detail).toBeTruthy();
    });

    it('can’t take an exam’s way forward with a failed result', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        let c = await filed(NEW, applicationOf(person));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
        const failed = await step(c, as.examiner, 'pass', { heldOn: today(), practical: 20, passed: false });
        expect(failed.statusCode, failed.body).toBe(422);
        expect((await caseOf(c.id)).state).toBe('exam');
        expect(await count('select count(*)::int as n from competency.exam_results where case_id = $1', [c.id])).toBe(
            0
        );
    });

    it('does not count an expired licence towards the next grade', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        await api.owner.query(
            `update competency.driver_licences set kind = 'permanent', valid_until = $2 where id = $1`,
            [licence.id, yearsAgo(2)]
        );
        await api.owner.query('update competency.licence_grades set permanent_since = $2 where licence_id = $1', [
            licence.id,
            yearsAgo(5)
        ]);
        await trained(person, 'taxi');
        const c = await filed(NEW, applicationOf(person, { grade: 'taxi' }));
        const res = await step(c, as.officer, 'submit');
        expect(res.statusCode, res.body).toBe(422);
    }, 180_000);

    it('records its use of the birth date, and never the date', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        await moved(await filed(NEW, applicationOf(person)), as.officer, 'submit');
        const { rows } = await api.owner.query<{ diff: unknown }>(
            `select diff from kernel.audit_log where event_type = 'person.revealed' and row_id = $1`,
            [person]
        );
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(rows)).toContain('licence eligibility');
        expect(JSON.stringify(rows)).not.toContain(yearsAgo(30));
    });
});

describe('a licence', () => {
    it('is pending and nobody’s yet while the national platform has not answered, and the request is in the outbox', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const [licence] = await licenceOf(person);
        expect(licence).toMatchObject({
            status: 'pending_national',
            kind: 'temporary',
            number: null,
            issuedOn: null,
            validUntil: null,
            nationalReference: null,
            caseId: c.id,
            grades: [{ key: 'automobile', permanentSince: null }]
        });
        expect(
            await count(
                `select count(*)::int as n from kernel.outbox_events
                  where type = 'licence.national-requested.v1' and payload->>'licenceId' = $1`,
                [licence?.id]
            )
        ).toBe(1);
        // the facts landed in typed tables: the medical examination and the exam result are not only answers
        expect(
            await count('select count(*)::int as n from competency.medical_certificates where case_id = $1', [c.id])
        ).toBe(1);
        const { rows } = await api.owner.query<{ theory: number; practical: number; passed: boolean; attempt: number }>(
            'select theory, practical, passed, attempt from competency.exam_results where case_id = $1',
            [c.id]
        );
        expect(rows).toEqual([{ theory: 80, practical: 75, passed: true, attempt: 1 }]);
        expect(await factsOf(c.id)).toMatchObject({ personId: person, exam: { passed: true } });
        // no certificate, no printer
        expect(
            await count('select count(*)::int as n from competency.licence_print_batch_items where licence_id = $1', [
                licence?.id
            ])
        ).toBe(0);
        expect(
            await count('select count(*)::int as n from documents.issued_documents where case_id = $1', [c.id])
        ).toBe(0);
    });

    it('becomes a temporary licence for 2 years when accepted, with its number, card and place in a print batch', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const licenceId = (await licenceOf(person))[0]?.id ?? '';
        const fake = new FakeNationalDriverPlatform();
        expect(
            await askNationalPlatform(system, { ...deps, platform: fake }, { caseId: c.id, licenceId, kind: 'new' })
        ).toBe('accepted');
        // only what the platform needs: no Fayda number, no full birth date
        const [asked] = fake.requests;
        expect(asked).toMatchObject({
            licenceId,
            grades: ['automobile'],
            officeCode: 'WOL-BODITI',
            birthYear: Number(yearsAgo(30).slice(0, 4))
        });
        expect(JSON.stringify(asked)).not.toContain(yearsAgo(30));

        const [licence] = await licenceOf(person);
        expect((await caseOf(c.id)).state).toBe('issued');
        expect(licence).toMatchObject({
            status: 'active',
            kind: 'temporary',
            issuedOn: today(),
            validUntil: `${Number(today().slice(0, 4)) + 2}${today().slice(4)}`
        });
        expect(licence?.number).toMatch(/^WOL-BODITI\/DL\/\d{6}$/);
        expect(licence?.nationalReference).toMatch(/^FAKE-DL-/);

        const { rows: docs } = await api.owner.query<{
            number: string;
            subject_table: string;
            data: { holderName: string; grades: { grade: string }[]; birthDate: string };
        }>(
            `select d.number, d.subject_table, d.data from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where t.key = 'licence-card' and d.subject_id = $1`,
            [licenceId]
        );
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({ number: licence?.number, subject_table: 'competency.driver_licences' });
        expect(docs[0]?.data.grades[0]?.grade).toBe('automobile');
        expect(
            await count('select count(*)::int as n from competency.licence_print_batch_items where licence_id = $1', [
                licenceId
            ])
        ).toBe(1);
        // the system actor, on record
        const { rows: events } = await api.owner.query<{ system_actor: string; to_state: string }>(
            `select system_actor, to_state from workflow.case_events where case_id = $1 and to_state = 'issued'`,
            [c.id]
        );
        expect(events[0]?.system_actor).toBe(NATIONAL_ACTOR);
    }, 120_000);

    it('stays one licence, with one number, when the answer is delivered again', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const licenceId = (await licenceOf(person))[0]?.id ?? '';
        const event = { caseId: c.id, licenceId, kind: 'new' as const };
        await askNationalPlatform(system, deps, event);
        const first = await licenceOf(person);
        expect(await askNationalPlatform(system, deps, event)).toBe('accepted');
        expect(await licenceOf(person)).toEqual(first);
        expect(first).toHaveLength(1);
    }, 120_000);

    it('takes the number from the platform when it issues them', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const licenceId = (await licenceOf(person))[0]?.id ?? '';
        const issuing = new FakeNationalDriverPlatform({ issuesNumbers: true });
        await askNationalPlatform(system, { ...deps, platform: issuing }, { caseId: c.id, licenceId, kind: 'new' });
        expect((await licenceOf(person))[0]?.number).toMatch(/^ETH-FAKE-DL-/);
    }, 120_000);

    it('moves nothing while the platform has not decided', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const licenceId = (await licenceOf(person))[0]?.id ?? '';
        const stalling = new FakeNationalDriverPlatform({ decide: () => ({ status: 'pending' }) });
        expect(
            await askNationalPlatform(system, { ...deps, platform: stalling }, { caseId: c.id, licenceId, kind: 'new' })
        ).toBe('pending');
        expect((await caseOf(c.id)).state).toBe('national');
        expect((await licenceOf(person))[0]?.status).toBe('pending_national');
    });

    it('is the same request after a timeout, and a corrected request makes a new licence', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const first = (await licenceOf(person))[0]?.id ?? '';
        const timedOut = async () =>
            system.systemContext('test.timeout', (tx) =>
                deps.cases.deliver(tx, c.id, 'timeout', { kind: 'system', id: 'system:timer' }, 'am', { quiet: true })
            );
        await timedOut();
        const back = await caseOf(c.id);
        expect(back.state).toBe('approval');
        await moved(back, as.lead, 'approve');
        expect((await licenceOf(person)).map((l) => l.id)).toEqual([first]);

        await timedOut();
        const again = await caseOf(c.id);
        // what was filed changed while it waited: the licence must be the one approved
        await api.owner.query(
            `update forms.submissions set answers = jsonb_set(answers, '{grade}', '"truck-1"') where case_id = $1`,
            [c.id]
        );
        await moved(again, as.lead, 'approve');
        const live = (await licenceOf(person)).filter((l) => l.status === 'pending_national');
        expect(live).toHaveLength(1);
        expect(live[0]?.id).not.toBe(first);
        expect(live[0]?.grades[0]?.key).toBe('truck-1');
        const { rows } = await api.owner.query<{ status: string; void_reason: string }>(
            'select status, void_reason from competency.driver_licences where id = $1',
            [first]
        );
        expect(rows[0]).toEqual({ status: 'voided', void_reason: 'request_changed' });
    }, 120_000);

    it('is voided when refused, with the reason, and a new approval makes a new one with no gap in the numbers', async () => {
        const person = await registered(yearsAgo(30));
        const c = await atNational(person);
        const voided = (await licenceOf(person))[0]?.id ?? '';
        const refusing = new FakeNationalDriverPlatform({
            decide: () => ({ status: 'rejected', reason: 'name mismatch' })
        });
        expect(
            await askNationalPlatform(
                system,
                { ...deps, platform: refusing },
                { caseId: c.id, licenceId: voided, kind: 'new' }
            )
        ).toBe('rejected');
        const back = await caseOf(c.id);
        expect(back.state).toBe('approval');
        const { rows } = await api.owner.query<{ status: string; void_reason: string; number: string | null }>(
            'select status, void_reason, number from competency.driver_licences where id = $1',
            [voided]
        );
        expect(rows[0]).toEqual({ status: 'voided', void_reason: 'name mismatch', number: null });

        const again = await moved(back, as.lead, 'approve');
        expect(again.state).toBe('national');
        const live = (await licenceOf(person)).filter((l) => l.status === 'pending_national');
        expect(live).toHaveLength(1);
        expect(live[0]?.id).not.toBe(voided);
    }, 120_000);
});

describe('a renewal', () => {
    const renewal = async (licence: string): Promise<CaseOut> => {
        const c = await filed(RENEW, { licence, medicalFacility: 'Sample Health Centre', medicalExaminedOn: today() });
        return moved(c, as.officer, 'submit');
    };
    const expire = (id: string, day: string) =>
        api.owner.query('update competency.driver_licences set valid_until = $2 where id = $1', [id, day]);
    const accept = async (c: CaseOut, licenceId: string) =>
        askNationalPlatform(system, deps, { caseId: c.id, licenceId, kind: 'renewal' });

    it('changes nothing until the platform accepts, then gives 4 years, and the old card’s QR says superseded', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        await expire(licence.id, yearsAgo(0));
        let c = await renewal(licence.id);
        expect(await factsOf(c.id)).toMatchObject({
            renewal: { lateOverYear: false, over55: false, years: 4, temporary: true }
        });
        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('approval');
        c = await moved(c, as.lead, 'approve');
        expect((await licenceOf(person))[0]?.validUntil).toBe(yearsAgo(0));

        expect(await accept(c, licence.id)).toBe('accepted');
        const [renewed] = await licenceOf(person);
        expect(renewed).toMatchObject({
            status: 'active',
            kind: 'permanent',
            number: licence.number,
            validUntil: `${Number(today().slice(0, 4)) + 4}${today().slice(4)}`,
            grades: [{ key: 'automobile', permanentSince: today() }]
        });
        const { rows } = await api.owner.query<{ superseded_by: string | null }>(
            `select d.superseded_by from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where t.key = 'licence-card' and d.subject_id = $1 order by d.created_at`,
            [licence.id]
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]?.superseded_by).not.toBeNull();
        expect(rows[1]?.superseded_by).toBeNull();
        // the new card belongs to the renewal's case
        const filedWith = await api.call('GET', `/api/v1/issued-documents?caseId=${c.id}`, as.officer);
        expect(filedWith.json<{ items: { templateKey: string }[] }>().items.map((d) => d.templateKey)).toContain(
            'licence-card'
        );
    }, 180_000);

    it('adds a practical exam when more than a year late', async () => {
        const { licence } = await licensed(yearsAgo(30));
        await expire(licence.id, yearsAgo(2));
        let c = await renewal(licence.id);
        expect(await factsOf(c.id)).toMatchObject({ renewal: { lateOverYear: true } });
        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('field_exam');
        c = await moved(c, as.examiner, 'pass', { heldOn: today(), practical: 70, passed: true });
        expect(c.state).toBe('approval');
        const { rows } = await api.owner.query<{ theory: number | null; practical: number }>(
            'select theory, practical from competency.exam_results where case_id = $1',
            [c.id]
        );
        expect(rows).toEqual([{ theory: null, practical: 70 }]);
    }, 180_000);

    it('gives 2 years to a holder over 55', async () => {
        const { person, licence } = await licensed(yearsAgo(60));
        await expire(licence.id, yearsAgo(0));
        let c = await renewal(licence.id);
        c = await moved(c, as.officer, 'approve');
        c = await moved(c, as.lead, 'approve');
        await accept(c, licence.id);
        expect((await licenceOf(person))[0]?.validUntil).toBe(`${Number(today().slice(0, 4)) + 2}${today().slice(4)}`);
    }, 180_000);

    it('opens only near expiry, and two open cases on one licence give one term', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        // far from its expiry: a renewal now would stack terms
        const early = await filed(RENEW, {
            licence: licence.id,
            medicalFacility: 'Sample Health Centre',
            medicalExaminedOn: today()
        });
        const tooEarly = await step(early, as.officer, 'submit');
        expect(tooEarly.statusCode, tooEarly.body).toBe(422);

        await expire(licence.id, yearsAgo(0));
        let one = await renewal(licence.id);
        let two = await renewal(licence.id);
        one = await moved(one, as.officer, 'approve');
        one = await moved(one, as.lead, 'approve');
        two = await moved(two, as.officer, 'approve');
        two = await moved(two, as.lead, 'approve');
        await accept(one, licence.id);
        const term = (await licenceOf(person))[0]?.validUntil;
        await accept(two, licence.id);
        expect((await caseOf(two.id)).state).toBe('issued');
        expect((await licenceOf(person))[0]?.validUntil).toBe(term);
    }, 240_000);

    it('is refused for a licence another office handles: it needs a transfer first', async () => {
        const { licence } = await licensed(yearsAgo(30));
        await expire(licence.id, yearsAgo(0));
        const zone = await api.unit('SER', 'WOL');
        await api.owner.query('update competency.driver_licences set handling_unit_id = $2 where id = $1', [
            licence.id,
            zone.id
        ]);
        const c = await filed(RENEW, {
            licence: licence.id,
            medicalFacility: 'Sample Health Centre',
            medicalExaminedOn: today()
        });
        const res = await step(c, as.officer, 'submit');
        expect(res.statusCode, res.body).toBe(422);
    }, 180_000);

    it('takes only an active licence', async () => {
        const person = await registered(yearsAgo(30));
        await atNational(person);
        const pending = (await licenceOf(person))[0]?.id ?? '';
        const c = await filed(RENEW, { licence: pending, medicalFacility: 'Sample', medicalExaminedOn: today() }).catch(
            () => null
        );
        if (c) expect((await step(c, as.officer, 'submit')).statusCode).toBe(422);
    });

    it('leaves the licence as it was when refused', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        await expire(licence.id, yearsAgo(0));
        let c = await renewal(licence.id);
        c = await moved(c, as.officer, 'approve');
        c = await moved(c, as.lead, 'approve');
        const refusing = new FakeNationalDriverPlatform({
            decide: () => ({ status: 'rejected', reason: 'unpaid fines' })
        });
        await askNationalPlatform(
            system,
            { ...deps, platform: refusing },
            { caseId: c.id, licenceId: licence.id, kind: 'renewal' }
        );
        const back = await caseOf(c.id);
        expect(back.state).toBe('approval');
        expect((await licenceOf(person))[0]).toMatchObject({
            status: 'active',
            validUntil: yearsAgo(0),
            kind: 'temporary'
        });

        // the holder paid; the lead approves again, and it is a new decision for the platform, not the old refusal replayed
        await moved(back, as.lead, 'approve');
        const { rows } = await api.owner.query<{ attempt: number }>(
            `select (payload->>'attempt')::int as attempt from kernel.outbox_events
              where type = 'licence.national-requested.v1' and payload->>'caseId' = $1 order by created_at`,
            [c.id]
        );
        expect(rows.map((r) => r.attempt)).toEqual([0, 1]);
        const answer = await askNationalPlatform(
            system,
            { ...deps, platform: refusing },
            { caseId: c.id, licenceId: licence.id, kind: 'renewal', attempt: 1 }
        );
        expect(answer).toBe('rejected');
        expect(new Set(refusing.requests.map((r) => r.requestId)).size).toBe(2);
        const later = new FakeNationalDriverPlatform();
        await moved(await caseOf(c.id), as.lead, 'approve');
        expect(
            await askNationalPlatform(
                system,
                { ...deps, platform: later },
                { caseId: c.id, licenceId: licence.id, kind: 'renewal', attempt: 2 }
            )
        ).toBe('accepted');
        expect((await licenceOf(person))[0]?.kind).toBe('permanent');
    }, 180_000);
});

describe('a print batch', () => {
    const batches = async (who: As) => {
        const res = await api.call('GET', '/api/v1/competency/print-batches', who);
        expect(res.statusCode, res.body).toBe(200);
        return res.json<{
            items: {
                id: string;
                status: string;
                licences: number;
                version: number;
                nationalReference: string | null;
            }[];
        }>().items;
    };

    it('goes to the printer once, through the worker, by those who may print', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const batch = (await batches(as.lead)).find((b) => b.status === 'open');
        expect(batch?.licences).toBeGreaterThan(0);
        const id = batch?.id ?? '';
        expect(
            await count(
                'select count(*)::int as n from competency.licence_print_batch_items where batch_id = $1 and licence_id = $2',
                [id, licence.id]
            )
        ).toBe(1);

        const denied = await api.call(
            'POST',
            `/api/v1/competency/print-batches/${id}/sending`,
            as.officer,
            {},
            ifMatch(batch?.version ?? 0)
        );
        expect(denied.statusCode).toBe(403);
        const sent = await api.call(
            'POST',
            `/api/v1/competency/print-batches/${id}/sending`,
            as.lead,
            {},
            { ...ifMatch(batch?.version ?? 0), 'idempotency-key': randomUUID() }
        );
        expect(sent.statusCode, sent.body).toBeLessThan(300);
        expect(sent.json<{ status: string }>().status).toBe('requested');
        expect(
            await count(
                `select count(*)::int as n from kernel.outbox_events where type = 'licence-batch.print-requested.v1' and payload->>'batchId' = $1`,
                [id]
            )
        ).toBe(1);

        const fake = new FakeNationalDriverPlatform();
        expect(await sendPrintBatch(system, { platform: fake }, id)).toBe(true);
        expect(fake.printRequests[0]?.licences.map((l) => l.licenceId)).toContain(licence.id);
        expect((await batches(as.lead)).find((b) => b.id === id)).toMatchObject({
            status: 'sent'
        });
        expect((await batches(as.lead)).find((b) => b.id === id)?.nationalReference).toMatch(/^FAKE-PRINT-/);
        // delivered again: nothing more goes out
        expect(await sendPrintBatch(system, { platform: fake }, id)).toBe(false);
        expect(fake.printRequests).toHaveLength(1);
        // the next licence opens a new one
        await licensed(yearsAgo(30));
        expect((await batches(as.lead)).filter((b) => b.status === 'open')).toHaveLength(1);
    }, 180_000);
});

describe('who sees what', () => {
    it('finds a licence by number or holder for a form, and a school only among schools', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const found = await api.call(
            'GET',
            `/api/v1/registry-lookups/driver-licence?q=${encodeURIComponent(licence.number ?? '')}`,
            as.officer
        );
        expect(found.statusCode, found.body).toBe(200);
        const items = found.json<{ items: { id: string; label: string; facts: { key: string; value: string }[] }[] }>()
            .items;
        expect(items.map((i) => i.id)).toContain(licence.id);
        // what a clerk needs, and no birth date
        expect(JSON.stringify(items)).not.toContain(yearsAgo(30));
        const schools = await api.call('GET', `/api/v1/registry-lookups/training-school?q=Sample`, as.officer);
        expect(schools.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toContain(school);
        const garages = await api.call('GET', `/api/v1/registry-lookups/training-school?q=Garage`, as.officer);
        expect(garages.json<{ items: unknown[] }>().items).toEqual([]);
    }, 120_000);

    it('asks permission for the register, and a sibling office sees no training list', async () => {
        expect((await api.call('GET', '/api/v1/competency/licences', as.damotRecords)).statusCode).toBe(403);
        expect((await api.call('GET', '/api/v1/competency/print-batches', as.officer)).statusCode).toBe(403);

        const person = await registered(yearsAgo(30));
        await trained(person);
        const client = new Client({ connectionString: pg.url('app') });
        await client.connect();
        try {
            const damot = as.damotRecords.unit;
            await client.query('begin');
            await client.query(
                `select set_config('app.region_id', $1, true), set_config('app.unit_id', $2, true), set_config('app.scope_path', $3, true)`,
                [damot.regionId, damot.id, damot.path]
            );
            // class T: the office's own; class R: the region reads the register
            const lists = await client.query('select id from competency.training_enrolments where person_id = $1', [
                person
            ]);
            expect(lists.rows).toEqual([]);
            const held = await client.query('select count(*)::int as n from competency.licence_grade_types');
            expect((held.rows[0] as { n: number }).n).toBe(13);
            await client.query('rollback');
        } finally {
            await client.end();
        }
    });
});
