/**
 * The two licence services as they are seeded (task 0.24b), run end to end through the API: no service-specific code but their effects.
 * What is seeded is also put through the checks a bureau's own version would meet, so a seed can't quietly be something the platform
 * would refuse.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LicencesService } from '@itrms/competency/api';
import { askNationalPlatform, type NationalDeps } from '@itrms/competency/api/worker';
import type { Licence } from '@itrms/competency/contracts';
import {
    importLicenceGrades,
    importLicenceRestrictionService,
    importLicenceServices,
    MEDICAL_REFERRAL_FORM,
    MEDICAL_REPORT_FORM,
    NEW_LICENCE_FORM,
    newLicenceFlow,
    renewalFlowV2,
    RENEWAL_FORM_V2,
    setUpDrivingPermitCounters,
    setUpLicenceCounters,
    setUpMedicalReferralCounters
} from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { FakeNationalDriverPlatform } from '@itrms/integrations/api';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { CasesService } from '@itrms/workflow/api';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { setLicenceNumbering, setRegionSetting } from './support/licences';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEE_RULES = join(HERE, '..', '..', '..', '..', 'modules', 'competency', 'seed', 'fee-rules.demo.yaml');

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    officer: '0199f0a0-d000-7000-8000-00000000d602',
    examiner: '0199f0a0-d000-7000-8000-00000000d603',
    lead: '0199f0a0-d000-7000-8000-00000000d604',
    zoneLead: '0199f0a0-d000-7000-8000-00000000d605',
    zoneOfficer: '0199f0a0-d000-7000-8000-00000000d606',
    finance: '0199f0a0-d000-7000-8000-000000000108',
    cashier: '0199f0a0-d000-7000-8000-000000000303',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    // the demo's own (apps/api/seed/users/wolaita.demo.yaml): the zone's auditor, Damot Gale's head
    auditor: '0199f0a0-d000-7000-8000-000000000109',
    damotHead: '0199f0a0-d000-7000-8000-000000000201'
};
const NEW = 'DVC-03';
const RENEW = 'DVC-04';

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let deps: NationalDeps;
let school: string;
const as = {} as Record<keyof typeof SUB, As>;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const yearsAgo = (years: number) => `${Number(today().slice(0, 4)) - years}${today().slice(4)}`;
const yearsOn = (years: number) => yearsAgo(-years);

let serial = 0;
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const lettersOf = (n: number, alphabet: string) =>
    [Math.floor(n / alphabet.length), n % alphabet.length].map((i) => alphabet[i % alphabet.length] ?? '').join('');

async function registered(birthDate: string): Promise<string> {
    serial += 1;
    const res = await api.call('POST', '/api/v1/persons', as.officer, {
        nameAm: { given: 'ሰላም', father: `ከበደ${lettersOf(serial, ETHIOPIC)}`, grandfather: 'ተሰማ' },
        nameEn: { given: 'Sample', father: `Applicant${lettersOf(serial, LATIN)}`, grandfather: 'Person' },
        sex: 'female',
        birthYear: Number(birthDate.slice(0, 4)),
        sensitive: { birthDate },
        acknowledgedDuplicates: []
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
}

async function trained(person: string, grade = 'automobile', who: As = as.officer): Promise<void> {
    const enrolled = await api.call('POST', '/api/v1/competency/training-enrolments', who, {
        personId: person,
        schoolId: school,
        grade
    });
    expect(enrolled.statusCode, enrolled.body).toBe(201);
    const { id, version } = enrolled.json<{ id: string; version: number }>();
    const done = await api.call(
        'POST',
        `/api/v1/competency/training-enrolments/${id}/completion`,
        who,
        { completedOn: today() },
        ifMatch(version)
    );
    expect(done.statusCode, done.body).toBeLessThan(300);
}

const application = (person: string, over: Record<string, unknown> = {}) => ({
    person,
    grade: 'automobile',
    educationGrade: 10,
    school,
    medicalFacility: 'Sample Health Centre',
    medicalExaminedOn: today(),
    ...over
});

const preview = async (code: string, answers: object, who: As) => {
    const res = await api.call('POST', '/api/v1/fees/preview', who, { serviceCode: code, answers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{
        feeRuleVersionId: string;
        totalSantim: string;
        lines: { key: string; amountSantim: string }[];
        demo: boolean;
    }>();
};

async function filed(code: string, answers: Record<string, unknown>, who: As = as.officer): Promise<CaseOut> {
    const shown = await preview(code, answers, who);
    const started = await api.call('POST', '/api/v1/service-requests', who, {
        serviceCode: code,
        answers,
        fee: { ruleVersionId: shown.feeRuleVersionId, totalSantim: shown.totalSantim }
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

const caseOf = async (id: string, who: As = as.officer) =>
    (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();

const licencesOf = async (person: string): Promise<Licence[]> =>
    (await api.call('GET', `/api/v1/competency/licences?personId=${person}`, as.officer)).json<{ items: Licence[] }>()
        .items;

/** Pays a case's fee at the till, as the office's revenue collector, and returns the case as it then stands. */
async function paid(c: CaseOut, who: As = as.cashier): Promise<{ receiptId: string; total: string }> {
    const order = await api.call('GET', `/api/v1/cases/${c.id}/payment`, who);
    expect(order.statusCode, order.body).toBe(200);
    const { id, totalSantim } = order.json<{ id: string; totalSantim: string }>();
    const res = await api.call(
        'POST',
        `/api/v1/payment-orders/${id}/payments`,
        who,
        { method: 'cash', amountSantim: totalSantim, receivedFrom: 'Sample Applicant' },
        { 'idempotency-key': randomUUID() }
    );
    expect(res.statusCode, res.body).toBe(201);
    return { receiptId: res.json<{ receipt: { id: string } }>().receipt.id, total: totalSantim };
}

const EXAM = () => ({ heldOn: today(), theory: 80, practical: 75, passed: true });

/** A new licence, all the way to where the lead has approved. */
async function approved(person: string): Promise<CaseOut> {
    await trained(person);
    let c = await filed(NEW, application(person));
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    c = await moved(c, as.examiner, 'pass', { answers: EXAM() });
    expect(c.state).toBe('payment');
    await paid(c);
    c = await caseOf(c.id);
    expect(c.state).toBe('approval');
    c = await moved(c, as.lead, 'approve');
    expect(c.state).toBe('national');
    return c;
}

/** A person holding an active licence. */
async function licensed(birthDate: string): Promise<{ person: string; licence: Licence }> {
    const person = await registered(birthDate);
    const c = await approved(person);
    const licenceId = (await licencesOf(person))[0]?.id ?? '';
    await askNationalPlatform(system, deps, { caseId: c.id, licenceId, kind: 'new' });
    const [licence] = await licencesOf(person);
    if (!licence) throw new Error('no licence');
    expect(licence.status).toBe('active');
    return { person, licence };
}

/** A renewal request on version 2 (task 1.6a): the medical examination is a step of its own. */
const renewalOf = (licence: Licence, expiry: string, over: Record<string, unknown> = {}) => ({
    licence: licence.id,
    grade: 'automobile',
    expiry,
    ...over
});

/** A renewal request on version 1: the certificate typed with the request. */
const renewalV1Of = (licence: Licence, expiry: string) => ({
    ...renewalOf(licence, expiry),
    medicalFacility: 'Sample Health Centre',
    medicalExaminedOn: today()
});

/** The health bureau's report as it came back. */
const REPORT = (over: Record<string, unknown> = {}) => ({
    facility: 'Sample Health Centre',
    examinedOn: today(),
    reportNumber: 'HB-0042',
    recommendation: 'grant',
    ...over
});

/** Filed, submitted and reviewed: the holder brought a report, recorded as granting. */
async function cleared(c: CaseOut, report: Record<string, unknown> = REPORT()): Promise<CaseOut> {
    c = await moved(c, as.officer, 'submit');
    c = await moved(c, as.officer, 'approve');
    expect(c.state).toBe('medical');
    return moved(c, as.officer, 'fit', { answers: report });
}

const reportsOf = (caseId: string) =>
    api.owner.query<{
        sequence: number;
        facility: string;
        recommendation: string | null;
        report_number: string | null;
        conditions_ct: Buffer | null;
    }>(
        `select sequence, facility, recommendation, report_number, conditions_ct from competency.medical_certificates
          where case_id = $1 order by sequence`,
        [caseId]
    );

const referralsOf = (caseId: string) =>
    api.owner.query<{ number: string; superseded_by: string | null; data: { institution: string; attempt: number } }>(
        `select d.number, d.superseded_by, d.data from documents.issued_documents d
           join documents.document_templates t on t.id = d.template_id
          where d.case_id = $1 and t.key = 'licence-medical-referral' order by d.created_at`,
        [caseId]
    );

const expire = async (id: string, day: string, kind?: 'permanent') => {
    await api.owner.query('update competency.driver_licences set valid_until = $2 where id = $1', [id, day]);
    if (kind) await api.owner.query(`update competency.driver_licences set kind = 'permanent' where id = $1`, [id]);
};

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.dvc.officer',
            sub: SUB.officer,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [
                ['WOL-BODITI', 'competency.officer'],
                ['WOL-BODITI', 'records_officer']
            ]
        },
        {
            username: 'test.dvc.examiner',
            sub: SUB.examiner,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.examiner']]
        },
        {
            username: 'test.dvc.lead',
            sub: SUB.lead,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'competency.lead']]
        },
        {
            username: 'test.dvc.zone.lead',
            sub: SUB.zoneLead,
            region: 'SER',
            home: 'WOL',
            roles: [['WOL', 'competency.lead']]
        },
        {
            username: 'test.dvc.zone.officer',
            sub: SUB.zoneOfficer,
            region: 'SER',
            home: 'WOL',
            roles: [
                ['WOL', 'competency.officer'],
                ['WOL', 'records_officer']
            ]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.officer = { sub: SUB.officer, unit: boditi };
    as.examiner = { sub: SUB.examiner, unit: boditi };
    as.lead = { sub: SUB.lead, unit: boditi };
    as.cashier = { sub: SUB.cashier, unit: boditi };
    as.zoneLead = { sub: SUB.zoneLead, unit: zone };
    as.zoneOfficer = { sub: SUB.zoneOfficer, unit: zone };
    as.finance = { sub: SUB.finance, unit: zone };
    as.damotRecords = { sub: SUB.damotRecords, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };
    as.auditor = { sub: SUB.auditor, unit: zone };
    as.damotHead = { sub: SUB.damotHead, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };

    const root = { id: region.id, regionId: region.regionId };
    // the region numbers its licences (task 1.6): its code and range, then its counter
    await setLicenceNumbering(api, root);
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importLicenceGrades(tx, root);
        await importDocumentTemplates(tx, root);
        await setUpLicenceCounters(tx, root.regionId);
        // DVC-04 at version 1 first, as an installation seeded before task 1.6a is: the first test moves it to version 2
        expect(await importLicenceServices(tx, root, { renewalV1: true })).toBe(2);
        expect(await setUpMedicalReferralCounters(tx, root.regionId)).toBeGreaterThan(0);
        // the suspension and cancellation record (task 1.6c)
        expect(await importLicenceRestrictionService(tx, root)).toBe(1);
        // the temporary driving permit's counter (task 1.6d)
        expect(await setUpDrivingPermitCounters(tx, root.regionId)).toBeGreaterThan(0);
    });
    deps = {
        platform: new FakeNationalDriverPlatform(),
        licences: api.http.get(LicencesService),
        cases: api.http.get(CasesService)
    };
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

describe('the renewal’s version 2 (task 1.6a)', () => {
    it('is seeded over version 1, whose cases finish on the version they froze', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let old = await filed(RENEW, renewalV1Of(licence, expiry));
        old = await moved(old, as.officer, 'submit');
        old = await moved(old, as.officer, 'approve');
        expect(old.state).toBe('payment');
        expect(Object.keys(old.stateLabels)).not.toContain('medical');

        const region = as.bureau.unit;
        const seed = () =>
            api.installer.scoped({}, (tx) => importLicenceServices(tx, { id: region.id, regionId: region.regionId }));
        // while a bureau has a draft of the renewal's form open, its form cannot move: neither does the service, as
        // version 2's flow must never run on version 1's request
        const draft = (hash: string) =>
            api.owner.query(
                `update forms.form_definitions set document_hash = ${hash} where key = 'driver-licence-renewal'`
            );
        await draft(`repeat('a', 64)`);
        expect(await seed()).toBe(0);
        await draft(
            `(select v.content_hash from forms.form_versions v where v.id = form_definitions.published_version_id)`
        );
        expect(await seed()).toBe(1);
        // a request filed now is on version 2: its examination is a step
        const other = await licensed(yearsAgo(30));
        await expire(other.licence.id, expiry, 'permanent');
        const fresh = await filed(RENEW, renewalOf(other.licence, expiry));
        expect(Object.keys(fresh.stateLabels)).toEqual(
            expect.arrayContaining(['referral', 'medical', 'medical_refused'])
        );
        expect(fresh.workflow.versionId).not.toBe(old.workflow.versionId);

        // the old case goes on as version 1 would
        await paid(old);
        old = await moved(await caseOf(old.id), as.lead, 'approve');
        expect(
            await askNationalPlatform(system, deps, { caseId: old.id, licenceId: licence.id, kind: 'renewal' })
        ).toBe('accepted');
        expect((await caseOf(old.id)).state).toBe('issued');
        expect((await licencesOf(person))[0]).toMatchObject({ validUntil: yearsOn(4), kind: 'permanent' });
        // its certificate was typed with the request: no recommendation
        expect((await reportsOf(old.id)).rows).toEqual([
            expect.objectContaining({ sequence: 1, recommendation: null })
        ]);
    }, 300_000);
});

describe('what is seeded', () => {
    it('stays as it is when seeded again', async () => {
        const region = await api.unit('SER', 'SER');
        const again = await api.installer.scoped({}, (tx) =>
            importLicenceServices(tx, { id: region.id, regionId: region.regionId })
        );
        expect(again).toBe(0);
    });

    it('passes the checks a bureau’s own form, workflow and service version would meet', async () => {
        const { rows } = await api.owner.query<{ code: string; form: string; flow: string; fee: string }>(
            `select d.code, v.form_version_id as form, v.workflow_version_id as flow, v.fee_rule_version_id as fee
               from services.service_definitions d join services.service_versions v on v.id = d.current_version_id
              where d.code in ('DVC-03', 'DVC-04')`
        );
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            const published = await api.call('POST', `/api/v1/services/${row.code}/versions`, as.bureau, {
                workflowVersionId: row.flow,
                formVersionId: row.form,
                feeRuleVersionId: row.fee,
                defaults: { approval_unit: 'handling' },
                overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'] }
            });
            expect(published.statusCode, published.body).toBe(201);
        }
        const flow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-new-licence',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: newLicenceFlow('licence-exam-result@1')
        });
        expect(flow.statusCode, flow.body).toBe(201);
        const form = await api.call('POST', '/api/v1/forms', as.bureau, {
            key: 'checked-new-licence',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            document: NEW_LICENCE_FORM
        });
        expect(form.statusCode, form.body).toBe(201);
        // the renewal's version 2 and its two step forms (task 1.6a), as a bureau's own would be checked
        const renewal = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
            key: 'checked-renewal',
            name: { am: 'ማረጋገጫ', en: 'Checked' },
            definition: renewalFlowV2('licence-exam-result@1', 'licence-medical-referral@1', 'licence-medical-report@1')
        });
        expect(renewal.statusCode, renewal.body).toBe(201);
        for (const [key, document] of [
            ['checked-renewal', RENEWAL_FORM_V2],
            ['checked-referral', MEDICAL_REFERRAL_FORM],
            ['checked-report', MEDICAL_REPORT_FORM]
        ] as const) {
            const made = await api.call('POST', '/api/v1/forms', as.bureau, {
                key,
                name: { am: 'ማረጋገጫ', en: 'Checked' },
                document
            });
            expect(made.statusCode, made.body).toBe(201);
        }

        // what the bureau has now published is its own: seeding again leaves it alone
        const current = () =>
            api.owner.query<{ id: string }>(
                `select current_version_id as id from services.service_definitions where code in ('DVC-03', 'DVC-04') order by code`
            );
        const before = (await current()).rows;
        const region = as.bureau.unit;
        expect(
            await api.installer.scoped({}, (tx) =>
                importLicenceServices(tx, { id: region.id, regionId: region.regionId })
            )
        ).toBe(0);
        expect((await current()).rows).toEqual(before);
    });

    it('offers the services where a competency team is, and not at a woreda', async () => {
        const res = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: NEW,
            answers: {}
        });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json<{ code: string }>().code).toBe('not_configured');

        // the zone department handles licences as a town's team does
        const person = await registered(yearsAgo(30));
        await trained(person, 'automobile', as.zoneOfficer);
        const filedAtZone = await filed(NEW, application(person), as.zoneOfficer);
        expect((await moved(filedAtZone, as.zoneOfficer, 'submit')).state).toBe('review');
    });
});

describe('a new licence', () => {
    it('runs from the counter to a licence, with a receipt, a temporary term and a card', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        const answers = application(person);
        const shown = await preview(NEW, answers, as.officer);
        // the demo's placeholder amounts: licence 300 Birr + exam 150 + card 100
        expect(shown).toMatchObject({ totalSantim: '55000', demo: true });

        let c = await filed(NEW, answers);
        expect(c.state).toBe('draft');
        c = await moved(c, as.officer, 'submit');
        expect(c.state).toBe('review');

        // returned once, corrected, and sent back
        c = await moved(c, as.officer, 'return', { comment: 'The medical certificate is unreadable' });
        expect(c.state).toBe('draft');
        c = await moved(c, as.officer, 'correct', {
            answers: { ...answers, medicalFacility: 'Another Health Centre' }
        });
        expect(c.state).toBe('review');

        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('exam');

        // failed first: the case stays for a retake, and both are on record
        c = await moved(c, as.examiner, 'fail', { answers: { heldOn: today(), theory: 30, passed: false } });
        expect(c.state).toBe('exam');
        const notYet = await step(c, as.examiner, {
            action: 'pass',
            answers: { heldOn: today(), theory: 30, passed: false }
        });
        expect(notYet.statusCode, notYet.body).toBe(422);
        c = await moved(c, as.examiner, 'pass', { answers: EXAM() });
        expect(c.state).toBe('payment');
        const { rows: exams } = await api.owner.query<{ attempt: number; passed: boolean }>(
            'select attempt, passed from competency.exam_results where case_id = $1 order by attempt',
            [c.id]
        );
        expect(exams).toEqual([
            { attempt: 1, passed: false },
            { attempt: 2, passed: true }
        ]);

        // the case goes on by itself once it is paid
        const { total } = await paid(c);
        expect(total).toBe('55000');
        c = await caseOf(c.id);
        expect(c.state).toBe('approval');

        // the people who checked it may not approve it
        const refused = await step(c, as.examiner, { action: 'approve' });
        expect(refused.statusCode).toBe(403);

        c = await moved(c, as.lead, 'approve');
        expect(c.state).toBe('national');
        const licenceId = (await licencesOf(person))[0]?.id ?? '';
        expect(await askNationalPlatform(system, deps, { caseId: c.id, licenceId, kind: 'new' })).toBe('accepted');

        expect((await caseOf(c.id)).state).toBe('issued');
        expect((await licencesOf(person))[0]).toMatchObject({
            status: 'active',
            kind: 'temporary',
            validUntil: yearsOn(2),
            grades: [{ key: 'automobile' }]
        });
        const docs = await api.call('GET', `/api/v1/issued-documents?caseId=${c.id}`, as.officer);
        const kinds = docs.json<{ items: { templateKey: string }[] }>().items.map((d) => d.templateKey);
        expect(kinds).toContain('licence-card');
    }, 240_000);

    it('gives nothing if the payment was reversed: not on approval, and not when the platform answers', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        let c = await filed(NEW, application(person));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
        c = await moved(c, as.examiner, 'pass', { answers: EXAM() });
        const { receiptId } = await paid(c);
        c = await caseOf(c.id);
        expect(c.state).toBe('approval');

        const reverse = async () => {
            const asked = await api.call('POST', `/api/v1/receipts/${receiptId}/reversals`, as.cashier, {
                reason: 'the applicant paid twice'
            });
            expect(asked.statusCode, asked.body).toBe(201);
            const decided = await api.call(
                'POST',
                `/api/v1/receipt-reversals/${asked.json<{ id: string }>().id}/decision`,
                as.finance,
                { decision: 'approved' }
            );
            expect(decided.statusCode, decided.body).toBe(200);
        };
        c = await moved(c, as.lead, 'approve');
        expect(c.state).toBe('national');
        await reverse();

        // the platform accepts, but the fee no longer stands: the case does not go on, and no licence is made
        const licenceId = (await licencesOf(person))[0]?.id ?? '';
        await askNationalPlatform(system, deps, { caseId: c.id, licenceId, kind: 'new' });
        expect((await caseOf(c.id)).state).toBe('national');
        expect((await licencesOf(person))[0]?.status).toBe('pending_national');

        // back at approval after its wait, it can't be approved either, only rejected
        await system.systemContext('test.timeout', (tx) =>
            deps.cases.deliver(tx, c.id, 'timeout', { kind: 'system', id: 'system:timer' }, 'am', { quiet: true })
        );
        const back = await caseOf(c.id);
        expect(back.state).toBe('approval');
        expect((await step(back, as.lead, { action: 'approve' })).statusCode).toBeGreaterThanOrEqual(400);
        const rejected = await moved(back, as.lead, 'reject', { comment: 'The fee was refunded' });
        expect(rejected.state).toBe('rejected');

        // the licence waiting for it goes with it, and doesn't stand in the holder's way
        const { rows } = await api.owner.query<{ status: string; void_reason: string }>(
            'select status, void_reason from competency.driver_licences where id = $1',
            [licenceId]
        );
        expect(rows[0]).toEqual({ status: 'voided', void_reason: 'case_closed' });
        const again = await filed(NEW, application(person));
        expect((await moved(again, as.officer, 'submit')).state).toBe('review');
    }, 240_000);

    it('can be withdrawn while it is a draft, and a refused request doesn’t stay open for ever', async () => {
        const person = await registered(yearsAgo(17));
        await trained(person);
        const c = await filed(NEW, application(person));
        expect((await step(c, as.officer, { action: 'submit' })).statusCode).toBe(422);
        const closed = await moved(await caseOf(c.id), as.officer, 'withdraw', { comment: 'Too young for now' });
        expect(closed.state).toBe('rejected');
    });

    it('is refused while another request for the same grade is open, and at final approval as a last resort', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        let first = await filed(NEW, application(person));
        first = await moved(first, as.officer, 'submit');
        const second = await filed(NEW, application(person));
        expect((await step(second, as.officer, { action: 'submit' })).statusCode).toBe(422);

        // two that got past that (a fact changed by hand): the second to reach approval is still refused
        await api.owner.query(`update workflow.cases set facts = facts - 'personId' where id = $1`, [first.id]);
        const passed = await moved(await caseOf(second.id), as.officer, 'submit');
        expect(passed.state).toBe('review');
        await api.owner.query(
            `update workflow.cases set facts = facts || jsonb_build_object('personId', $2::text) where id = $1`,
            [first.id, person]
        );
        const bring = async (c: CaseOut) => {
            let now = await moved(await caseOf(c.id), as.officer, 'approve');
            now = await moved(now, as.examiner, 'pass', { answers: EXAM() });
            await paid(now);
            return caseOf(now.id);
        };
        const a = await bring(first);
        const b = await bring(passed);
        await moved(a, as.lead, 'approve');
        expect((await step(b, as.lead, { action: 'approve' })).statusCode).toBe(422);
        expect((await licencesOf(person)).filter((l) => l.status !== 'voided')).toHaveLength(1);
    }, 240_000);

    it('takes its medical examination’s months from the region’s setting', async () => {
        const region = as.bureau.unit;
        const person = await registered(yearsAgo(30));
        await trained(person);
        const old = `${yearsAgo(1)}`;
        const c = await filed(NEW, application(person, { medicalExaminedOn: old }));
        expect((await step(c, as.officer, { action: 'submit' })).statusCode).toBe(422);
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${region.id}/settings/competency.medical_valid_months`,
            as.bureau,
            { value: 24 },
            ifMatch(0)
        );
        expect(set.statusCode, set.body).toBeLessThan(300);
        const passed = await moved(await caseOf(c.id), as.officer, 'submit');
        expect(passed.state).toBe('review');
        const reset = await api.call(
            'DELETE',
            `/api/v1/org-units/${region.id}/settings/competency.medical_valid_months`,
            as.bureau,
            undefined,
            ifMatch(set.json<{ version?: number }>().version ?? 1)
        );
        expect(reset.statusCode, reset.body).toBeLessThan(300);
    });

    it('goes to the zone’s lead for approval once the office’s override says so', async () => {
        const boditi = as.officer.unit;
        const config = await api.call('GET', `/api/v1/org-units/${boditi.id}/services/${NEW}/configuration`, as.bureau);
        expect(config.statusCode, config.body).toBe(200);
        const version = config.json<{ own: { version: number } | null }>().own?.version ?? 0;
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${boditi.id}/services/${NEW}/override`,
            as.bureau,
            { values: { approval_unit: 'parent' }, reason: 'the zone approves for this town' },
            ifMatch(version)
        );
        expect(set.statusCode, set.body).toBeLessThan(300);

        const person = await registered(yearsAgo(30));
        await trained(person);
        let c = await filed(NEW, application(person));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
        c = await moved(c, as.examiner, 'pass', { answers: EXAM() });
        await paid(c);
        c = await caseOf(c.id, as.zoneLead);
        expect(c.state).toBe('approval');
        // the town's lead no longer decides it
        expect((await step(c, as.lead, { action: 'approve' })).statusCode).toBe(403);
        c = await moved(c, as.zoneLead, 'approve');
        expect(c.state).toBe('national');

        const now = await api.call('GET', `/api/v1/org-units/${boditi.id}/services/${NEW}/configuration`, as.bureau);
        const undo = await api.call(
            'DELETE',
            `/api/v1/org-units/${boditi.id}/services/${NEW}/override`,
            as.bureau,
            undefined,
            ifMatch(now.json<{ own: { version: number } | null }>().own?.version ?? 0)
        );
        expect(undo.statusCode, undo.body).toBeLessThan(300);
    }, 240_000);

    it('is never sent above the region: its root has no office above it', async () => {
        const region = as.bureau.unit;
        const config = await api.call('GET', `/api/v1/org-units/${region.id}/services/${NEW}/configuration`, as.bureau);
        const set = await api.call(
            'PUT',
            `/api/v1/org-units/${region.id}/services/${NEW}/override`,
            as.bureau,
            { values: { approval_unit: 'parent' }, reason: 'above the region' },
            ifMatch(config.json<{ own: { version: number } | null }>().own?.version ?? 0)
        );
        expect(set.statusCode, set.body).toBe(422);
        expect(set.body).toContain('approval_unit');
    });
});

describe('a case’s audit trail', () => {
    interface Line {
        action: string;
        table: string | null;
        event: string | null;
        actor: { id: string; name: string } | null;
        fields: string[];
    }

    it('tells an auditor above the office who did what and when, with the fields changed but none of their values', async () => {
        const person = await registered(yearsAgo(30));
        await trained(person);
        let c = await filed(NEW, application(person));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'return', { comment: 'The scan of the ID is unreadable' });

        const res = await api.call('GET', `/api/v1/cases/${c.id}/audit`, as.auditor);
        expect(res.statusCode, res.body).toBe(200);
        const { items } = res.json<{ items: Line[] }>();
        // the case, its request and its steps, by the office's people
        expect(items.some((l) => l.table === 'workflow.cases' && l.action === 'insert')).toBe(true);
        expect(items.some((l) => l.table === 'forms.submissions')).toBe(true);
        // a step taken on: the task's update names its case beside the change
        expect(items.some((l) => l.table === 'workflow.case_tasks' && l.action === 'update')).toBe(true);
        expect(
            items.some((l) => l.table === 'workflow.cases' && l.action === 'update' && l.fields.includes('state'))
        ).toBe(true);
        // each by the person who did it, by name (the test's officer acts at Boditi)
        expect(items.filter((l) => l.actor !== null).length).toBeGreaterThan(0);
        expect(items.every((l) => l.actor === null || l.actor.name !== '')).toBe(true);
        // never a value: not the applicant, not the comment, not the new state
        expect(res.body).not.toContain(person);
        expect(res.body).not.toContain('unreadable');
        expect(res.body).not.toContain('"draft"');

        // the read is on record, and the trail shows it
        const again = await api.call('GET', `/api/v1/cases/${c.id}/audit`, as.auditor);
        expect(again.json<{ items: Line[] }>().items.some((l) => l.event === 'case.audit_read')).toBe(true);
    });

    it('is for those who may read the audit log, of the cases their scope shows', async () => {
        const person = await registered(yearsAgo(31));
        await trained(person);
        const c = await filed(NEW, application(person));
        // a licensing officer works the case, but doesn't read the audit log
        expect((await api.call('GET', `/api/v1/cases/${c.id}/audit`, as.officer)).statusCode).toBe(403);
        // a woreda's head reads its own audit, and Boditi's case is not in its scope
        expect((await api.call('GET', `/api/v1/cases/${c.id}/audit`, as.damotHead)).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/cases/${c.id}/audit`, as.auditor)).statusCode).toBe(200);
    });
});

describe('a renewal', () => {
    it('is on time: straight to payment, 4 years, and the licence is permanent', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let c = await cleared(await filed(RENEW, renewalOf(licence, expiry)));
        expect(c.state).toBe('payment');
        const { total } = await paid(c);
        // renewal 200 Birr, nothing late
        expect(total).toBe('20000');
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        expect(await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' })).toBe(
            'accepted'
        );
        expect((await caseOf(c.id)).state).toBe('issued');
        expect((await licencesOf(person))[0]).toMatchObject({ validUntil: yearsOn(4), kind: 'permanent' });
    }, 240_000);

    it('is more than a year late: a practical exam is added, and the fee has its late parts', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(2);
        await expire(licence.id, expiry, 'permanent');
        const answers = renewalOf(licence, expiry);
        const shown = await preview(RENEW, answers, as.officer);
        expect(shown.lines.map((l) => l.key)).toEqual(expect.arrayContaining(['base', 'penalty', 'overAYear']));

        let c = await cleared(await filed(RENEW, answers));
        expect(c.state).toBe('field_exam');
        c = await moved(c, as.examiner, 'pass', { answers: { heldOn: today(), practical: 70, passed: true } });
        expect(c.state).toBe('payment');
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' });
        expect((await licencesOf(person))[0]?.validUntil).toBe(yearsOn(4));
    }, 240_000);

    it('of a temporary licence has its offence record checked first', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry);
        let c = await cleared(await filed(RENEW, renewalOf(licence, expiry)));
        expect(c.state).toBe('offence_check');
        c = await moved(c, as.officer, 'clear');
        expect(c.state).toBe('payment');
    }, 240_000);

    it('gives a holder over 55 two years', async () => {
        const { person, licence } = await licensed(yearsAgo(60));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let c = await cleared(await filed(RENEW, renewalOf(licence, expiry)));
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' });
        expect((await licencesOf(person))[0]?.validUntil).toBe(yearsOn(2));
    }, 240_000);

    it('lets the people on a renewal see the licence: the counter files it, and an examiner reads its case', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const records = { sub: '0199f0a0-d000-7000-8000-000000000302', unit: as.officer.unit };
        for (const who of [records, as.examiner]) {
            const found = await api.call(
                'GET',
                `/api/v1/registry-lookups/driver-licence?q=${encodeURIComponent(licence.number ?? '')}`,
                who
            );
            expect(found.statusCode, found.body).toBe(200);
            expect(found.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toContain(licence.id);
        }
    }, 240_000);

    it('is refused if what the fee was worked out from disagrees with the register', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        // a later expiry than the real one would hide the late penalty, and a cheaper grade would lower the fee
        for (const over of [{ expiry: yearsOn(1) }, { grade: 'motorcycle' }]) {
            const c = await filed(RENEW, renewalOf(licence, expiry, over));
            const res = await step(c, as.officer, { action: 'submit' });
            expect(res.statusCode, res.body).toBe(422);
        }
    }, 240_000);
});

describe('a renewal’s medical examination (task 1.6a)', () => {
    /** A permanent licence due now, its renewal filed and reviewed. */
    async function reviewed(): Promise<{ person: string; licence: Licence; c: CaseOut }> {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let c = await filed(RENEW, renewalOf(licence, expiry));
        c = await moved(c, as.officer, 'submit');
        expect(c.state).toBe('review');
        return { person, licence, c };
    }
    const refer = async (c: CaseOut, institution: string) => {
        c = await moved(c, as.officer, 'refer');
        expect(c.state).toBe('referral');
        return moved(c, as.officer, 'issue_referral', { answers: { institution } });
    };

    it('writes a referral letter from the office’s counter, with its QR, and a granting report goes on', async () => {
        const { person, licence, c: filedCase } = await reviewed();
        let c = await refer(filedCase, 'Sample Health Centre');
        expect(c.state).toBe('medical');
        const [letter] = (await referralsOf(c.id)).rows;
        expect(letter?.number).toMatch(/\/MR\/\d{5}\/\d{4}$/);
        expect(letter?.data).toMatchObject({ institution: 'Sample Health Centre', attempt: 1 });
        // a letter carries no health fact
        expect(JSON.stringify(letter?.data)).not.toMatch(/recommendation|condition/i);
        const docs = await api.call('GET', `/api/v1/issued-documents?caseId=${c.id}`, as.officer);
        expect(docs.statusCode, docs.body).toBe(200);
        expect(docs.body).toContain('licence-medical-referral');

        c = await moved(c, as.officer, 'fit', { answers: REPORT() });
        expect(c.state).toBe('payment');
        expect((await reportsOf(c.id)).rows).toEqual([
            expect.objectContaining({
                sequence: 1,
                recommendation: 'grant',
                report_number: 'HB-0042',
                conditions_ct: null
            })
        ]);
        // the recommendation is a health outcome: never in the audit log
        const logged = await api.owner.query<{ diff: unknown }>(
            `select a.diff from kernel.audit_log a join competency.medical_certificates m on m.id = a.row_id
              where a.table_name = 'competency.medical_certificates' and m.case_id = $1`,
            [c.id]
        );
        expect(logged.rows).toHaveLength(1);
        expect(JSON.stringify(logged.rows)).not.toMatch(/grant|recommendation/);
        // and the reports are listed to those who record health facts only
        const listed = await api.call('GET', `/api/v1/competency/cases/${c.id}/medical-reports`, as.examiner);
        expect(listed.statusCode).toBe(403);
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' });
        expect((await caseOf(c.id)).state).toBe('issued');
        expect((await licencesOf(person))[0]?.validUntil).toBe(yearsOn(4));
    }, 300_000);

    it('refuses an action that disagrees with the report, and a report dated before its referral or too long ago', async () => {
        const { c: filedCase } = await reviewed();
        const c = await refer(filedCase, 'Sample Health Centre');
        expect(
            (await step(c, as.officer, { action: 'fit', answers: REPORT({ recommendation: 'refuse' }) })).statusCode
        ).toBe(422);
        expect((await step(c, as.officer, { action: 'unfit', answers: REPORT() })).statusCode).toBe(422);
        expect(
            (await step(c, as.officer, { action: 'fit', answers: REPORT({ examinedOn: yearsAgo(2) }) })).statusCode
        ).toBe(422);
        expect((await reportsOf(c.id)).rows).toEqual([]);
    }, 300_000);

    it('stops on a refused report: referred again to another institution, up to the third, then only rejected', async () => {
        const { person, licence, c: filedCase } = await reviewed();
        let c = await refer(filedCase, 'Sample Health Centre');
        c = await moved(c, as.officer, 'unfit', { answers: REPORT({ recommendation: 'refuse' }) });
        expect(c.state).toBe('medical_refused');
        // a refusal goes nowhere on: neither on to payment nor to a report of its own
        for (const action of ['fit', 'approve'])
            expect((await step(c, as.officer, { action })).statusCode).toBeGreaterThanOrEqual(400);

        // the same institution is not a second opinion
        c = await moved(c, as.officer, 'refer');
        const same = await step(c, as.officer, {
            action: 'issue_referral',
            answers: { institution: ' sample  HEALTH centre ' }
        });
        expect(same.statusCode, same.body).toBe(422);
        c = await moved(c, as.officer, 'issue_referral', { answers: { institution: 'Sample Hospital' } });
        const letters = (await referralsOf(c.id)).rows;
        expect(letters).toHaveLength(2);
        // the second letter supersedes the first, with its own number
        expect(letters[0]?.superseded_by).not.toBeNull();
        expect(letters[1]).toMatchObject({ superseded_by: null, data: { institution: 'Sample Hospital', attempt: 2 } });
        expect(letters[1]?.number).not.toBe(letters[0]?.number);
        c = await moved(c, as.officer, 'unfit', {
            answers: REPORT({ facility: 'Sample Hospital', recommendation: 'refuse' })
        });
        c = await refer(c, 'Sample Referral Hospital');
        c = await moved(c, as.officer, 'unfit', {
            answers: REPORT({ facility: 'Sample Referral Hospital', recommendation: 'refuse' })
        });
        expect(c.state).toBe('medical_refused');
        // three institutions have refused (Art. 13): no fourth
        const fourth = await step(c, as.officer, { action: 'refer' });
        expect(fourth.statusCode, fourth.body).toBe(409);
        expect((await reportsOf(c.id)).rows.map((r) => [r.sequence, r.recommendation])).toEqual([
            [1, 'refuse'],
            [2, 'refuse'],
            [3, 'refuse']
        ]);
        c = await moved(c, as.lead, 'reject', { comment: 'Three institutions refused the medical examination.' });
        expect(c.state).toBe('rejected');
        expect((await licencesOf(person))[0]).toMatchObject({ id: licence.id, validUntil: yearsAgo(0) });
    }, 300_000);

    it('a refused report followed by another institution’s grant goes on', async () => {
        const { c: filedCase } = await reviewed();
        let c = await moved(filedCase, as.officer, 'approve');
        c = await moved(c, as.officer, 'unfit', { answers: REPORT({ recommendation: 'refuse' }) });
        c = await refer(c, 'Sample Hospital');
        c = await moved(c, as.officer, 'fit', { answers: REPORT({ facility: 'Sample Hospital' }) });
        expect(c.state).toBe('payment');
        // a granted report needs no other
        const res = await api.owner.query(
            `select count(*)::int as n from competency.medical_certificates where case_id = $1`,
            [c.id]
        );
        expect(res.rows[0]).toEqual({ n: 2 });
    }, 300_000);

    it('keeps the conditions a report grants with encrypted, out of every form, list and log, and wants them before approval', async () => {
        const { licence, c: filedCase } = await reviewed();
        let c = await moved(filedCase, as.officer, 'approve');
        c = await moved(c, as.officer, 'fit', { answers: REPORT({ recommendation: 'grant_with_conditions' }) });
        await paid(c);
        c = await caseOf(c.id);
        expect(c.state).toBe('approval');
        // no conditions yet: the lead cannot send it on
        const early = await step(c, as.lead, { action: 'approve' });
        expect(early.statusCode, early.body).toBe(409);

        const listed = await api.call('GET', `/api/v1/competency/cases/${c.id}/medical-reports`, as.officer);
        expect(listed.statusCode, listed.body).toBe(200);
        const [report] = listed.json<{ items: { id: string; conditionsOnRecord: boolean }[] }>().items;
        expect(report).toMatchObject({ conditionsOnRecord: false });
        const id = report?.id ?? '';
        const CONDITIONS = 'Drives only with corrective glasses';
        // only a report that grants with conditions takes them, and only from those who record health facts
        expect(
            (
                await api.call('POST', `/api/v1/competency/medical-reports/${id}/conditions`, as.examiner, {
                    conditions: CONDITIONS
                })
            ).statusCode
        ).toBe(403);
        const recorded = await api.call('POST', `/api/v1/competency/medical-reports/${id}/conditions`, as.officer, {
            conditions: CONDITIONS
        });
        expect(recorded.statusCode, recorded.body).toBe(200);
        expect(recorded.json()).toMatchObject({ conditionsOnRecord: true });
        expect(recorded.body).not.toContain('glasses');

        // at rest a ciphertext only, audited in the same transaction without the value
        const { rows } = await api.owner.query<{ ct: Buffer; same_tx: boolean; diff: unknown }>(
            `select m.conditions_ct as ct, m.xmin::text = a.xmin::text as same_tx, a.diff
               from competency.medical_certificates m
               join kernel.audit_log a on a.table_name = 'competency.medical_certificates' and a.row_id = m.id
              where m.id = $1 and a.action = 'update'`,
            [id]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.ct.toString('utf8')).not.toContain('glasses');
        expect(rows[0]?.same_tx).toBe(true);
        expect(JSON.stringify(rows[0]?.diff)).not.toMatch(/glasses|conditionsCt|conditions_ct/);
        const anywhere = await api.owner.query<{ n: number }>(
            `select (select count(*) from kernel.audit_log where diff::text like '%glasses%')
                  + (select count(*) from workflow.case_events where data::text like '%glasses%')
                  + (select count(*) from workflow.cases where facts::text like '%glasses%')
                  + (select count(*) from forms.submissions where answers::text like '%glasses%') as n`
        );
        expect(Number(anywhere.rows[0]?.n)).toBe(0);
        // the case page says only that they are on record
        const page = await api.call('GET', `/api/v1/cases/${c.id}`, as.lead);
        expect(page.body).not.toContain('glasses');

        // read in clear by the lead only, with a reason and a recent second factor, on record first
        const reveal = (who: As, reason = 'checking the conditions before the approval') =>
            api.call('POST', `/api/v1/competency/medical-reports/${id}/conditions/reveal`, who, { reason });
        expect((await reveal(as.officer)).statusCode).toBe(403);
        expect((await reveal({ ...as.lead, authAge: 900 })).statusCode).toBe(401);
        const shown = await reveal(as.lead);
        expect(shown.statusCode, shown.body).toBe(200);
        expect(shown.json()).toEqual({ conditions: CONDITIONS });
        const events = await api.owner.query<{ actor_id: string; diff: { fields: string[]; reason: string } }>(
            `select actor_id, diff from kernel.audit_log where event_type = 'licence.medical_conditions_revealed' and row_id = $1`,
            [id]
        );
        expect(events.rows).toEqual([
            expect.objectContaining({
                diff: { fields: ['conditions'], reason: 'checking the conditions before the approval' }
            })
        ]);
        // another office's people do not find the report at all
        expect((await reveal(as.damotHead)).statusCode).toBeGreaterThanOrEqual(403);

        c = await moved(await caseOf(c.id), as.lead, 'approve');
        expect(c.state).toBe('national');
        // what the lead checked is what goes: no change once the renewal is sent on
        const sent = await api.call('POST', `/api/v1/competency/medical-reports/${id}/conditions`, as.officer, {
            conditions: 'No conditions after all'
        });
        expect(sent.statusCode, sent.body).toBe(409);
        await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' });
        expect((await caseOf(c.id)).state).toBe('issued');
        // closed: the conditions no longer change
        const late = await api.call('POST', `/api/v1/competency/medical-reports/${id}/conditions`, as.officer, {
            conditions: 'Something else'
        });
        expect(late.statusCode, late.body).toBe(409);
    }, 300_000);

    it('takes no conditions for a report that grants none', async () => {
        const { c: filedCase } = await reviewed();
        let c = await moved(filedCase, as.officer, 'approve');
        c = await moved(c, as.officer, 'fit', { answers: REPORT() });
        const [report] = (await api.call('GET', `/api/v1/competency/cases/${c.id}/medical-reports`, as.officer)).json<{
            items: { id: string }[];
        }>().items;
        const res = await api.call(
            'POST',
            `/api/v1/competency/medical-reports/${report?.id ?? ''}/conditions`,
            as.officer,
            {
                conditions: 'None needed'
            }
        );
        expect(res.statusCode, res.body).toBe(409);
    }, 300_000);
});

describe('the suspension and cancellation record (DVC-21, task 1.6c)', () => {
    const RECORD = 'DVC-21';
    const SUSPENDED = ['ይህ ፈቃድ በአሁኑ ጊዜ ታግዷል', 'This licence is suspended'];
    const daysOn = (days: number) => {
        const d = new Date(`${today()}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    };

    /** The decision's scan the officer uploaded: stored, at Boditi. */
    async function scan(): Promise<string> {
        const id = randomUUID();
        const unit = as.officer.unit;
        await api.owner.query(
            `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
                 confirmed_at, origin, created_by)
             values ($1, $2, $3, 'stored', 'decision.pdf', 'application/pdf', 10, repeat('a', 64), $4, now(), 'upload', $5)`,
            [id, unit.regionId, unit.id, `files/${unit.regionId}/${id}`, await api.userId(SUB.officer)]
        );
        return id;
    }

    const decision = async (licence: Licence, over: Record<string, unknown> = {}) => ({
        licence: licence.id,
        kind: 'suspension',
        authority: 'court',
        authorityReference: `CR/${randomInt(1000, 9999)}/2019`,
        decidedOn: today(),
        startsOn: today(),
        endsOn: daysOn(90),
        decisionScan: [{ file_id: await scan() }],
        ...over
    });

    async function submittedRecord(answers: Record<string, unknown>): Promise<CaseOut> {
        const started = await api.call('POST', '/api/v1/service-requests', as.officer, {
            serviceCode: RECORD,
            answers
        });
        expect(started.statusCode, started.body).toBe(201);
        const c = await moved(started.json<CaseOut>(), as.officer, 'submit');
        expect(c.state).toBe('approval');
        return c;
    }

    const refusedAt = async (answers: Record<string, unknown>) => {
        const started = await api.call('POST', '/api/v1/service-requests', as.officer, {
            serviceCode: RECORD,
            answers
        });
        if (started.statusCode === 422) return started;
        expect(started.statusCode, started.body).toBe(201);
        return step(started.json<CaseOut>(), as.officer, { action: 'submit' });
    };

    const licenceNow = async (id: string): Promise<Licence> =>
        (await api.call('GET', `/api/v1/competency/licences/${id}`, as.officer)).json<Licence>();

    it('records a suspension only once the lead approves it, never the officer who filed it; while it holds, no renewal', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const expiry = daysOn(30);
        await expire(licence.id, expiry, 'permanent');
        const c = await submittedRecord(await decision(licence));
        // nothing on the register yet, and the filer cannot approve their own record
        expect((await licenceNow(licence.id)).restriction).toBeNull();
        expect((await step(c, as.officer, { action: 'approve' })).statusCode).toBe(403);
        const approving = await step(c, as.lead, { action: 'approve' });
        expect(approving.statusCode, approving.body).toBe(200);
        expect(approving.json<CaseOut>().state).toBe('recorded');

        const now = await licenceNow(licence.id);
        expect(now).toMatchObject({
            status: 'active',
            restricted: true,
            restriction: { kind: 'suspension', authority: 'court', startsOn: today(), endsOn: daysOn(90), caseId: c.id }
        });
        // the record on file, in the approving request's transaction
        const audited = await api.owner.query<{ line: string }>(
            `select table_name || ':' || action as line from kernel.audit_log
              where request_id = $1 and table_name like 'competency.%' order by 1`,
            [approving.headers['x-request-id']]
        );
        expect(audited.rows.map((r) => r.line)).toEqual(['competency.licence_restrictions:insert']);

        // a renewal is refused while it holds, for the suspension's reason
        const renewal = await filed(RENEW, renewalOf(now, expiry));
        const refused = await step(renewal, as.officer, { action: 'submit' });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(
            SUSPENDED.some((words) => refused.body.includes(words)),
            refused.body
        ).toBe(true);
    }, 240_000);

    it('shows a suspension that starts later, without blocking anything yet', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const c = await submittedRecord(await decision(licence, { startsOn: daysOn(10), endsOn: daysOn(40) }));
        await moved(c, as.lead, 'approve');
        expect(await licenceNow(licence.id)).toMatchObject({
            restricted: false,
            restriction: { kind: 'suspension', startsOn: daysOn(10) }
        });
    }, 240_000);

    it('cancels a licence: it ends, its card says revoked, and nothing more is recorded on it', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        const cards = async () =>
            (await api.call('GET', `/api/v1/issued-documents?subjectId=${licence.id}`, as.lead)).json<{
                items: { templateKey: string; revoked: boolean }[];
            }>().items;
        expect((await cards()).filter((d) => d.templateKey === 'licence-card' && !d.revoked)).toHaveLength(1);

        const c = await submittedRecord(await decision(licence, { kind: 'cancellation', endsOn: undefined }));
        await moved(c, as.lead, 'approve');
        expect(await licenceNow(licence.id)).toMatchObject({
            status: 'cancelled',
            restricted: true,
            restriction: { kind: 'cancellation', endsOn: null }
        });
        // its QR reports revoked: the verification page reads this flag
        const after = (await cards()).filter((d) => d.templateKey === 'licence-card');
        expect(after.length).toBeGreaterThan(0);
        expect(after.every((d) => d.revoked)).toBe(true);

        // the lookup no longer offers it (it is not active), so the form refuses it as it is filed; the record's check would too
        const again = await refusedAt(await decision(licence));
        expect(again.statusCode).toBe(422);
        const refusal = again
            .json<{ errors?: { path: string; code: string }[] }>()
            .errors?.find((e) => e.path === 'licence');
        expect(['invalid_reference', 'cancelled']).toContain(refusal?.code);

        // a new application waits the region's months after the cancellation (a setting; none by default)
        const root = { id: as.bureau.unit.id, regionId: as.bureau.unit.regionId };
        const newApplication = await filed(NEW, application(person));
        try {
            await setRegionSetting(api, root, 'competency.reapply_after_cancellation_months', 12);
            const waiting = await step(newApplication, as.officer, { action: 'submit' });
            expect(waiting.statusCode, waiting.body).toBe(422);
            expect(waiting.body).toMatch(/12/);
        } finally {
            await api.owner.query(
                `delete from kernel.settings_values where key = 'competency.reapply_after_cancellation_months'`
            );
        }
        const anew = await step(newApplication, as.officer, { action: 'submit' });
        expect(anew.statusCode, anew.body).toBe(200);
    }, 300_000);

    it('keeps a licence cancelled while its renewal waited on the national platform: no new term, no card', async () => {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let renewal = await cleared(await filed(RENEW, renewalOf(licence, expiry)));
        await paid(renewal);
        renewal = await moved(await caseOf(renewal.id), as.lead, 'approve');
        expect(renewal.state).toBe('national');

        // the court cancels it while the platform has the request
        const c = await submittedRecord(await decision(licence, { kind: 'cancellation', endsOn: undefined }));
        await moved(c, as.lead, 'approve');

        // the platform accepts: the case ends, saying why nothing was given
        expect(
            await askNationalPlatform(system, deps, { caseId: renewal.id, licenceId: licence.id, kind: 'renewal' })
        ).toBe('accepted');
        const ended = await caseOf(renewal.id);
        expect(ended.notices).toContain('competency.licenceRestriction.renewalWithheld');
        expect((await licencesOf(person))[0]).toMatchObject({ status: 'cancelled', validUntil: expiry });
        const cards = (await api.call('GET', `/api/v1/issued-documents?subjectId=${licence.id}`, as.lead)).json<{
            items: { templateKey: string; revoked: boolean; superseded: boolean }[];
        }>().items;
        expect(cards.filter((d) => d.templateKey === 'licence-card' && !d.revoked && !d.superseded)).toEqual([]);
    }, 300_000);

    it('refuses a cancellation dated after today: it takes effect when it is recorded', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const res = await refusedAt(
            await decision(licence, { kind: 'cancellation', endsOn: undefined, startsOn: daysOn(5) })
        );
        expect(res.statusCode).toBe(422);
        expect(res.json<{ errors?: { path: string; code: string }[] }>().errors).toContainEqual(
            expect.objectContaining({ path: 'startsOn', code: 'in_future' })
        );
    }, 240_000);

    it('is refused at filing for what the decision cannot say', async () => {
        const { licence } = await licensed(yearsAgo(30));
        const cases: [Record<string, unknown>, string][] = [
            [{ endsOn: undefined }, 'endsOn'],
            [{ kind: 'cancellation' }, 'endsOn'],
            [{ decidedOn: daysOn(2), startsOn: daysOn(2), endsOn: daysOn(9) }, 'decidedOn'],
            [{ decidedOn: today(), startsOn: daysOn(-3) }, 'startsOn'],
            [{ startsOn: daysOn(20), endsOn: daysOn(5) }, 'endsOn'],
            [{ authorityReference: '   ' }, 'authorityReference']
        ];
        for (const [over, path] of cases) {
            const res = await refusedAt(await decision(licence, over));
            expect(res.statusCode, `${JSON.stringify(over)} ${res.body}`).toBe(422);
            expect(res.json<{ errors?: { path: string }[] }>().errors?.map((e) => e.path)).toContain(path);
        }
    }, 240_000);
});

describe('the temporary driving permit and the card handover (task 1.6d)', () => {
    const daysOn = (days: number) => {
        const d = new Date(`${today()}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    };
    const permitsOf = (licenceId: string) =>
        api.owner.query<{
            id: string;
            number: string;
            revoked: boolean;
            data: { validUntil: string; issuedOn: string };
        }>(
            `select d.id, d.number, d.revoked_at is not null as revoked, d.data from documents.issued_documents d
               join documents.document_templates t on t.id = d.template_id
              where t.key = 'licence-driving-permit' and d.subject_id = $1 order by d.created_at`,
            [licenceId]
        );

    /** A licence renewed through version 2 and accepted nationally: its new card goes to print. */
    async function renewed(): Promise<{ person: string; licence: Licence }> {
        const { person, licence } = await licensed(yearsAgo(30));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let c = await cleared(await filed(RENEW, renewalOf(licence, expiry)));
        await paid(c);
        c = await moved(await caseOf(c.id), as.lead, 'approve');
        expect(await askNationalPlatform(system, deps, { caseId: c.id, licenceId: licence.id, kind: 'renewal' })).toBe(
            'accepted'
        );
        const [now] = await licencesOf(person);
        if (!now) throw new Error('no licence');
        return { person, licence: now };
    }

    const handOver = (licence: Licence, body: Record<string, unknown>, who: As = as.officer) =>
        api.call('POST', `/api/v1/competency/licences/${licence.id}/card-handover`, who, body, {
            ...ifMatch(licence.version),
            'idempotency-key': randomUUID()
        });
    const HOLDER = { recipient: 'holder', idKind: 'fayda', idNumber: '1234-5678-9012' };

    it('is given with the renewal while the region prints: numbered, standing its days', async () => {
        const { licence } = await renewed();
        const [permit, ...more] = (await permitsOf(licence.id)).rows;
        expect(more).toEqual([]);
        expect(permit?.number).toMatch(/^WOL-BODITI\/TP\/\d{5}\/\d{4}$/);
        expect(permit).toMatchObject({ revoked: false, data: { issuedOn: today(), validUntil: daysOn(89) } });
    }, 300_000);

    it('stands the region’s days, as set', async () => {
        const root = { id: as.bureau.unit.id, regionId: as.bureau.unit.regionId };
        await setRegionSetting(api, root, 'competency.driving_permit_days', 30);
        try {
            const { licence } = await renewed();
            expect((await permitsOf(licence.id)).rows[0]?.data.validUntil).toBe(daysOn(29));
        } finally {
            await api.owner.query(`delete from kernel.settings_values where key = 'competency.driving_permit_days'`);
        }
    }, 300_000);

    it('closes when the printed card is handed over: the permit is revoked, the ID kept encrypted', async () => {
        const { licence } = await renewed();
        // the card is not back from the printer: nothing to hand over yet
        expect((await handOver(licence, { ...HOLDER, cardSerial: 'PC-77001' })).statusCode).toBe(409);
        await api.owner.query(`update competency.driver_licences set card_serial = 'PC-77001' where id = $1`, [
            licence.id
        ]);
        const [printed] = await licencesOf(licence.personId);
        if (!printed) throw new Error('no licence');

        // not this card's serial
        const wrong = await handOver(printed, { ...HOLDER, cardSerial: 'PC-77002' });
        expect(wrong.statusCode, wrong.body).toBe(422);
        // a representative is named, the holder is not
        expect(
            (await handOver(printed, { ...HOLDER, recipient: 'representative', cardSerial: 'PC-77001' })).statusCode
        ).toBe(422);

        const given = await handOver(printed, { ...HOLDER, cardSerial: 'pc-77001' });
        expect(given.statusCode, given.body).toBe(201);
        expect(given.json()).toMatchObject({
            cardSerial: 'PC-77001',
            recipient: 'holder',
            idKind: 'fayda',
            permitsClosed: 1
        });
        expect((await permitsOf(licence.id)).rows.every((p) => p.revoked)).toBe(true);

        // on record in the same transaction, with no ID number in the audit log or in clear in the table
        const audited = await api.owner.query<{ line: string; diff: unknown }>(
            `select table_name || ':' || action as line, diff from kernel.audit_log
              where request_id = $1 and table_name in ('competency.licence_card_handovers', 'documents.issued_documents')
              order by 1`,
            [given.headers['x-request-id']]
        );
        expect(audited.rows.map((r) => r.line)).toEqual([
            'competency.licence_card_handovers:insert',
            'documents.issued_documents:update'
        ]);
        expect(JSON.stringify(audited.rows)).not.toContain('1234-5678-9012');
        const stored = await api.owner.query<{ ct: Buffer }>(
            `select id_number_ct as ct from competency.licence_card_handovers where licence_id = $1`,
            [licence.id]
        );
        expect(stored.rows[0]?.ct.toString('utf8')).not.toContain('1234-5678-9012');

        // once only
        const [after] = await licencesOf(printed.personId);
        if (!after) throw new Error('no licence');
        expect((await handOver(after, { ...HOLDER, cardSerial: 'PC-77001' })).statusCode).toBe(409);
    }, 300_000);

    it('is handed over by licensing at its office only: the cashier is refused', async () => {
        const { licence } = await renewed();
        expect((await handOver(licence, { ...HOLDER, cardSerial: 'PC-1' }, as.cashier)).statusCode).toBe(403);
    }, 300_000);
});
