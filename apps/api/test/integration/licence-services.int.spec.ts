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
    importLicenceServices,
    NEW_LICENCE_FORM,
    newLicenceFlow,
    setUpLicenceCounters
} from '@itrms/competency/seed';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules } from '@itrms/fees/seed';
import { FakeNationalDriverPlatform } from '@itrms/integrations/api';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { CasesService } from '@itrms/workflow/api';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
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

const renewalOf = (licence: Licence, expiry: string, over: Record<string, unknown> = {}) => ({
    licence: licence.id,
    grade: 'automobile',
    expiry,
    medicalFacility: 'Sample Health Centre',
    medicalExaminedOn: today(),
    ...over
});

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
    await api.installer.scoped({}, async (tx) => {
        await importFeeRules(tx, root, parseFeeRules(readFileSync(FEE_RULES, 'utf8')));
        await importLicenceGrades(tx, root);
        await importDocumentTemplates(tx, root);
        await setUpLicenceCounters(tx, root.regionId);
        expect(await importLicenceServices(tx, root)).toBe(2);
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
        let c = await filed(RENEW, renewalOf(licence, expiry));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
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

        let c = await filed(RENEW, answers);
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
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
        let c = await filed(RENEW, renewalOf(licence, expiry));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
        expect(c.state).toBe('offence_check');
        c = await moved(c, as.officer, 'clear');
        expect(c.state).toBe('payment');
    }, 240_000);

    it('gives a holder over 55 two years', async () => {
        const { person, licence } = await licensed(yearsAgo(60));
        const expiry = yearsAgo(0);
        await expire(licence.id, expiry, 'permanent');
        let c = await filed(RENEW, renewalOf(licence, expiry));
        c = await moved(c, as.officer, 'submit');
        c = await moved(c, as.officer, 'approve');
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
