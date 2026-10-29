/**
 * The service catalogue over HTTP (task 0.21b), on a real PostgreSQL 16 with the Wolaita seeds, Test Zone B and the
 * catalogue: the region publishes a version (its form and workflow checked); a woreda overrides the keys its policy lets
 * it, and only its own new cases get them (a sibling office, another zone keep the bureau's); a key the policy does not
 * allow is refused; a request freezes the configuration on its case, which keeps it whatever changes later; a new bureau
 * version re-checks the overrides and reports the ones that no longer fit; service enablement checks the catalogue.
 */
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000b201',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    damotAdmin: '0199f0a0-d000-7000-8000-00000000b202',
    boditiAdmin: '0199f0a0-d000-7000-8000-00000000b203',
    tzbAdmin: '0199f0a0-d000-7000-8000-00000000b204'
};
const SERVICE = 'RS-01';
const help = (en: string) => ({ am: `${en} (አማርኛ)`, en });

/** A review in business hours, then done. */
const workflow = (review: string) => ({
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
        {
            key: review,
            kind: 'task',
            label: { am: 'ማጣራት', en: 'Review' },
            assignee: { role: 'records_officer', unit: 'handling' },
            sla: { businessHours: 8 }
        },
        { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
    ],
    transitions: [
        { from: 'draft', to: review, action: 'submit' },
        { from: review, to: 'done', action: 'close', label: { am: 'ዝጋ', en: 'Close' } }
    ]
});

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<keyof typeof SUB, As>;
const ids = { v1Workflow: '', v2Workflow: '', v1Form: '', v2Form: '' };

const field = (id: string) => ({ id, type: 'InputText', label: id, props: {} });

/** A form published by the bureau (maker-checker: a second administrator approves); its version's id. */
async function publishedForm(key: string, fields: string[]): Promise<string> {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, {
        key,
        name: { am: key, en: key },
        document: { fields: fields.map(field) }
    });
    expect(created.statusCode, created.body).toBe(201);
    const asked = (
        await api.call('POST', `/api/v1/forms/${created.json<{ id: string }>().id}/publications`, as.bureau, {})
    ).json<{ id: string; version: number; formVersion: { id: string } }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2,
        {},
        { 'if-match': `"${asked.version}"` }
    );
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    return asked.formVersion.id;
}

async function storedWorkflow(key: string, review: string): Promise<string> {
    const res = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key,
        name: { am: key, en: key },
        definition: workflow(review)
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ latestVersion: { id: string } }>().latestVersion.id;
}

const publish = (who: As, body: object, code = SERVICE) =>
    api.call('POST', `/api/v1/services/${code}/versions`, who, body);
const override = (who: As, unitId: string, values: object, version: number) =>
    api.call(
        'PUT',
        `/api/v1/org-units/${unitId}/services/${SERVICE}/override`,
        who,
        { values, reason: 'local practice' },
        { 'if-match': `"${version}"` }
    );
const configuration = (who: As, unitId: string) =>
    api.call('GET', `/api/v1/org-units/${unitId}/services/${SERVICE}/configuration`, who);

/** A request at the person's office, and what its case froze (read as the owner: the case's own columns). */
async function requested(who: As) {
    const res = await api.call('POST', '/api/v1/service-requests', who, { serviceCode: SERVICE });
    expect(res.statusCode, res.body).toBe(201);
    const c = res.json<CaseOut>();
    const submitted = await api.call(
        'POST',
        `/api/v1/cases/${c.id}/transitions`,
        who,
        { action: 'submit' },
        { 'if-match': `"${c.version}"` }
    );
    expect(submitted.statusCode, submitted.body).toBe(200);
    return { id: c.id, ...(await frozen(c.id)) };
}
async function frozen(caseId: string) {
    const { rows } = await api.owner.query<{
        config: { serviceVersionId: string; sla: Record<string, unknown>; help: Record<string, unknown> };
        due: Date | null;
    }>(
        `select c.config, (select t.due_at from workflow.case_tasks t where t.case_id = c.id order by t.created_at limit 1) as due
           from workflow.cases c where c.id = $1`,
        [caseId]
    );
    const row = rows[0];
    if (!row) throw new Error('no case');
    return row;
}

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.bureau.second',
            sub: SUB.bureau2,
            region: 'SER',
            home: 'SER',
            roles: [['SER', 'bureau_admin']]
        },
        {
            username: 'test.damot.admin',
            sub: SUB.damotAdmin,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'unit_admin']]
        },
        {
            username: 'test.boditi.admin',
            sub: SUB.boditiAdmin,
            region: 'SER',
            home: 'WOL-BODITI',
            roles: [['WOL-BODITI', 'unit_admin']]
        },
        { username: 'test.tzb.admin', sub: SUB.tzbAdmin, region: 'SER', home: 'TZB', roles: [['TZB', 'unit_admin']] }
    ]);
    const region = await api.unit('SER', 'SER');
    const zone = await api.unit('SER', 'WOL');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.zoneAdmin = { sub: SUB.zoneAdmin, unit: zone };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.damotAdmin = { sub: SUB.damotAdmin, unit: damot };
    as.boditiAdmin = { sub: SUB.boditiAdmin, unit: boditi };
    as.tzbAdmin = { sub: SUB.tzbAdmin, unit: await api.unit('SER', 'TZB') };
    ids.v1Form = await publishedForm('road-safety-report', ['plate', 'remark']);
    ids.v2Form = await publishedForm('road-safety-report-2', ['plate']);
    ids.v1Workflow = await storedWorkflow('road-safety-review', 'review');
    ids.v2Workflow = await storedWorkflow('road-safety-check', 'check');
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('the catalogue', () => {
    it("lists the region's 54 services, what this office offers, and none configured yet", async () => {
        const res = await api.call('GET', '/api/v1/services', as.damotRecords);
        expect(res.statusCode).toBe(200);
        const list = res.json<{ code: string; enabled: boolean; configured: boolean }[]>();
        expect(list).toHaveLength(54);
        expect(list.find((s) => s.code === SERVICE)).toMatchObject({ enabled: true, configured: false });
        // licences are a zone's or a licensing town's, not a woreda's
        expect(list.find((s) => s.code === 'DVC-03')).toMatchObject({ enabled: false });
        const notYet = await api.call('POST', '/api/v1/service-requests', as.damotRecords, { serviceCode: SERVICE });
        expect(notYet.statusCode).toBe(409);
        expect(notYet.json()).toMatchObject({ code: 'not_configured' });
    });

    it("checks a code against the catalogue when an office's services change", async () => {
        const url = (code: string) => `/api/v1/org-units/${as.boditiRecords.unit.id}/services/${code}`;
        const unknown = await api.call(
            'PUT',
            url('ZZ-99'),
            as.zoneAdmin,
            { enabled: true, reason: 'pilot' },
            {
                'if-match': '"0"'
            }
        );
        expect(unknown.statusCode).toBe(422);
        expect(unknown.json()).toMatchObject({ errors: [{ code: 'unknown_service' }] });
        const on = await api.call(
            'PUT',
            url('LG-01'),
            as.zoneAdmin,
            { enabled: true, reason: 'pilot' },
            {
                'if-match': '"0"'
            }
        );
        expect(on.statusCode, on.body).toBe(200);
        expect(
            (await api.call('DELETE', url('LG-01'), as.zoneAdmin, undefined, { 'if-match': '"1"' })).statusCode
        ).toBe(200);
    });
});

describe('a bureau version', () => {
    it('is published by a seat at the region, naming a form and a workflow that exist, with defaults that fit them', async () => {
        const v1 = {
            formVersionId: ids.v1Form,
            workflowVersionId: ids.v1Workflow,
            defaults: { 'help.plate': help('The plate as written on the vehicle') },
            overridePolicy: { sla: ['unit'], help: ['unit'] }
        };
        expect((await publish(as.zoneAdmin, v1)).statusCode).toBe(403);
        expect((await publish(as.bureau, v1, 'ZZ-99')).statusCode).toBe(404);
        const unknownWorkflow = await publish(as.bureau, {
            ...v1,
            workflowVersionId: '0199f0a0-0000-7000-8000-00000000beef'
        });
        expect(unknownWorkflow.statusCode).toBe(422);
        expect(unknownWorkflow.json()).toMatchObject({ errors: [{ code: 'unknown_workflow' }] });
        const badDefault = await publish(as.bureau, { ...v1, defaults: { 'sla.payment': { businessHours: 4 } } });
        expect(badDefault.json()).toMatchObject({ errors: [{ path: 'defaults.sla.payment', code: 'unknown_state' }] });

        const res = await publish(as.bureau, v1);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json()).toMatchObject({ version: { number: 1 }, conflicts: [] });
        const list = (await api.call('GET', '/api/v1/services', as.damotRecords)).json<{ code: string }[]>();
        expect(list.find((s) => s.code === SERVICE)).toMatchObject({ configured: true, currentVersion: 1 });
    });
});

describe("a woreda's override", () => {
    it('of an allowed key holds for its own new cases only; a sibling office and another zone keep the bureau value', async () => {
        const damot = as.damotRecords.unit.id;
        // a key the policy does not let a unit change, a state the workflow does not have
        const notAllowed = await override(as.damotAdmin, damot, { approval_unit: 'region' }, 0);
        expect(notAllowed.statusCode).toBe(422);
        expect(notAllowed.json()).toMatchObject({ code: 'setting_level_not_allowed' });
        const unknownState = await override(as.damotAdmin, damot, { 'sla.payment': { businessHours: 1 } }, 0);
        expect(unknownState.json()).toMatchObject({ errors: [{ code: 'unknown_state' }] });
        // above the seat, and a sibling's (not seen)
        expect(
            (await override(as.damotAdmin, as.zoneAdmin.unit.id, { 'sla.review': { businessDays: 3 } }, 0)).statusCode
        ).toBe(403);
        expect((await override(as.boditiAdmin, damot, { 'sla.review': { businessDays: 3 } }, 0)).statusCode).toBe(404);

        const before = await requested(as.damotRecords);
        const set = await override(
            as.damotAdmin,
            damot,
            { 'sla.review': { businessDays: 3 }, 'help.remark': help('Why the report is late') },
            0
        );
        expect(set.statusCode, set.body).toBe(200);
        expect(set.json()).toMatchObject({ version: 1 });
        expect((await override(as.damotAdmin, damot, { 'sla.review': { businessDays: 4 } }, 0)).statusCode).toBe(409);

        // the woreda's own new case: its SLA and help text, frozen with where they came from
        const mine = await requested(as.damotRecords);
        expect(mine.config).toMatchObject({
            serviceCode: SERVICE,
            sla: { review: { businessDays: 3 } },
            help: { plate: help('The plate as written on the vehicle'), remark: help('Why the report is late') },
            sources: { 'sla.review': { level: 'unit', unitId: damot }, 'help.plate': { level: 'default' } }
        });
        // a step due three business days out, later than the workflow's eight hours
        expect(Number(mine.due) - Number(before.due)).toBeGreaterThan(86_400_000);
        // the case started before keeps what it froze
        expect((await frozen(before.id)).config.sla).toEqual({});

        // Boditi (a sibling) and Test Zone B's woreda keep the bureau's
        const boditi = await requested(as.boditiRecords);
        expect(boditi.config.sla).toEqual({});
        expect(boditi.config.help).toEqual({ plate: help('The plate as written on the vehicle') });
        const tzb = await configuration(as.tzbAdmin, (await api.unit('SER', 'TZB-W1')).id);
        expect(tzb.statusCode, tzb.body).toBe(200);
        expect(tzb.json<{ values: Record<string, unknown> }>().values).not.toHaveProperty('sla.review');
        // the woreda's configuration as its administrator sees it
        expect((await configuration(as.damotAdmin, damot)).json()).toMatchObject({
            values: { 'sla.review': { value: { businessDays: 3 }, source: { level: 'unit', unitId: damot } } },
            own: { version: 1 },
            problems: [],
            writable: true
        });
        expect((await configuration(as.boditiAdmin, damot)).statusCode).toBe(404);
    });
});

describe('a new bureau version', () => {
    it('re-checks the overrides below it and reports those that no longer fit; open cases keep theirs', async () => {
        const open = await requested(as.damotRecords);
        const res = await publish(as.bureau, {
            formVersionId: ids.v2Form,
            workflowVersionId: ids.v2Workflow,
            defaults: { 'sla.check': { businessHours: 4 } },
            overridePolicy: { sla: ['unit'] }
        });
        expect(res.statusCode, res.body).toBe(201);
        const damot = as.damotRecords.unit.id;
        expect(res.json<{ conflicts: unknown[] }>().conflicts).toEqual([
            {
                unitId: damot,
                unitName: expect.objectContaining({ en: 'Damot Gale' }) as unknown,
                key: 'help.remark',
                problem: 'not_allowed'
            },
            {
                unitId: damot,
                unitName: expect.objectContaining({ en: 'Damot Gale' }) as unknown,
                key: 'sla.review',
                problem: 'unknown_state'
            }
        ]);
        // the woreda's next case: the new version's values (its override's keys no longer fit and are passed over)
        const next = await requested(as.damotRecords);
        expect(next.config).toMatchObject({ sla: { check: { businessHours: 4 } }, help: {} });
        expect(next.config.serviceVersionId).not.toBe(open.config.serviceVersionId);
        // the open case runs on, on what it froze
        expect((await frozen(open.id)).config).toEqual(open.config);
        expect((await configuration(as.damotAdmin, damot)).json()).toMatchObject({
            problems: [
                { key: 'help.remark', problem: 'not_allowed' },
                { key: 'sla.review', problem: 'unknown_state' }
            ]
        });
    });

    it('audits every write: the catalogue, the versions, the overrides', async () => {
        const { rows } = await api.owner.query<{ table_name: string; action: string; n: number }>(
            `select table_name, action, count(*)::int as n from kernel.audit_log
              where table_name like 'services.%' and actor_id is not null group by 1, 2 order by 1, 2`
        );
        expect(rows).toEqual([
            { table_name: 'services.service_definitions', action: 'update', n: 2 },
            { table_name: 'services.service_overrides', action: 'insert', n: 1 },
            { table_name: 'services.service_versions', action: 'insert', n: 2 }
        ]);
    });
});
