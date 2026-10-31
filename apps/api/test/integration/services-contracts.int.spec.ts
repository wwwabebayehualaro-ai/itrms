/**
 * Effect input contracts over HTTP (task 0.21d), on a real PostgreSQL 16: an effect declares what it reads from the
 * service's request form; a service version naming a form that does not meet it is refused, with what is wrong in the
 * reader's language; a new version of that form leaving a contract field out cannot be published (the request is refused,
 * the publish check says why and what it touches); the builder's locks name the fields; the effect is given its input,
 * read through the version's input map.
 */
import { Injectable, Module } from '@nestjs/common';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import type { CaseOut } from '@itrms/workflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

/** Issues a permit from the request: the plate and the owner (by the form key the service maps it to). */
@Injectable()
@Effect('test.issuePermit', {
    input: { plate: { kind: 'text' }, holder: { kind: 'text' }, note: { kind: 'text', required: false } }
})
class IssuePermit implements WorkflowEffect<Record<string, unknown>> {
    run({ input }: EffectRun<Record<string, unknown>>) {
        return Promise.resolve({ facts: { permit: input } });
    }
}

@Module({ providers: [IssuePermit] })
class TestEffects {}

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000c201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};
const SERVICE = 'RS-05';

let pg: TestPostgres;
let api: TestApi;
const as = {} as Record<keyof typeof SUB, As>;
const ids = { form: '', formVersion: '', workflowVersion: '' };

const text = (id: string, required = false) => ({
    id,
    type: 'InputText',
    classification: 'personal',
    label: id,
    props: required ? { required: true } : {},
    behavior: { validation: { supported: true } }
});
const FORM = { schemaVersion: 2, fields: [text('plate', true), text('owner', true), text('remark')] };
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

/** A form published by the bureau, approved by a second administrator; its id and its version's. */
async function publishedForm(key: string, document: unknown) {
    const created = await api.call('POST', '/api/v1/forms', as.bureau, { key, name: { am: key, en: key }, document });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    const asked = (await api.call('POST', `/api/v1/forms/${id}/publications`, as.bureau, {})).json<{
        id: string;
        version: number;
        formVersion: { id: string };
    }>();
    const approved = await api.call(
        'POST',
        `/api/v1/form-publications/${asked.id}/approval`,
        as.bureau2,
        {},
        ifMatch(asked.version)
    );
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    return { id, versionId: asked.formVersion.id };
}

const publish = (body: object, language = 'en') =>
    api.call('POST', `/api/v1/services/${SERVICE}/versions`, as.bureau, body, { 'accept-language': language });

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.bureau.third',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            }
        ],
        { modules: [TestEffects] }
    );
    const region = await api.unit('SER', 'SER');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.bureau2 = { sub: SUB.bureau2, unit: region };
    as.damotRecords = { sub: SUB.damotRecords, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };
    const form = await publishedForm('permit-request', FORM);
    ids.form = form.id;
    ids.formVersion = form.versionId;
    const workflow = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'permit',
        name: { am: 'ፈቃድ', en: 'Permit' },
        definition: {
            schemaVersion: 1,
            states: [
                { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
                {
                    key: 'review',
                    kind: 'task',
                    label: { am: 'ማጣራት', en: 'Review' },
                    assignee: { role: 'records_officer', unit: 'handling' }
                },
                { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
            ],
            transitions: [
                { from: 'draft', to: 'review', action: 'submit' },
                {
                    from: 'review',
                    to: 'done',
                    action: 'issue',
                    label: { am: 'ስጥ', en: 'Issue' },
                    effects: ['test.issuePermit']
                }
            ]
        }
    });
    expect(workflow.statusCode, workflow.body).toBe(201);
    ids.workflowVersion = workflow.json<{ latestVersion: { id: string } }>().latestVersion.id;
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe("a service version and its effects' input contracts", () => {
    it('is refused while its request form does not meet them, saying what is wrong in the reader’s language', async () => {
        const base = { workflowVersionId: ids.workflowVersion, formVersionId: ids.formVersion };
        // the contract's holder is the form's owner: without the mapping the form has no "holder"
        const unmapped = await publish(base);
        expect(unmapped.statusCode).toBe(422);
        expect(unmapped.json()).toMatchObject({
            errors: [{ path: 'inputMap.test.issuePermit.holder', code: 'contract_missing' }]
        });
        const [english, amharic] = [unmapped, await publish(base, 'am')].map(
            (r) => r.json<{ errors: { message: string }[] }>().errors[0]?.message
        );
        expect(english).toContain('test.issuePermit');
        expect(english).toContain('"holder"');
        expect(amharic).not.toBe(english);
        expect(amharic).toContain('"holder"');
        // a mapping to a field that is optional; an effect the workflow does not run
        expect(
            (await publish({ ...base, inputMap: { 'test.issuePermit': { holder: 'remark' } } })).json()
        ).toMatchObject({ errors: [{ code: 'contract_not_required' }] });
        expect(
            (await publish({ ...base, inputMap: { 'test.other': { holder: 'owner' } } }))
                .json<{ errors: { code: string }[] }>()
                .errors.map((e) => e.code)
        ).toContain('unknown_effect');
        // a mapping naming a path the contract does not declare (a typo of the optional note)
        expect(
            (await publish({ ...base, inputMap: { 'test.issuePermit': { holder: 'owner', notee: 'remark' } } })).json<{
                errors: { code: string; path: string }[];
            }>().errors
        ).toEqual([expect.objectContaining({ path: 'inputMap.test.issuePermit.notee', code: 'unknown_path' })]);
        // no request form at all
        expect((await publish({ workflowVersionId: ids.workflowVersion })).json()).toMatchObject({
            errors: [{ path: 'formVersionId', code: 'contract_no_form' }]
        });

        const ok = await publish({ ...base, inputMap: { 'test.issuePermit': { holder: 'owner' } } });
        expect(ok.statusCode, ok.body).toBe(201);
        expect(ok.json()).toMatchObject({ version: { inputMap: { 'test.issuePermit': { holder: 'owner' } } } });
    });
});

describe('a form a service’s effects read', () => {
    it('shows its locked fields, and a new version leaving one out cannot be published', async () => {
        const locks = await api.call('GET', `/api/v1/forms/${ids.form}/locks`, as.bureau);
        expect(locks.json<{ items: unknown[] }>().items).toEqual([
            { key: 'note', kind: 'text', required: false, effects: ['test.issuePermit'], services: [SERVICE] },
            { key: 'owner', kind: 'text', required: true, effects: ['test.issuePermit'], services: [SERVICE] },
            { key: 'plate', kind: 'text', required: true, effects: ['test.issuePermit'], services: [SERVICE] }
        ]);

        // the owner taken out of the working copy
        const form = (await api.call('GET', `/api/v1/forms/${ids.form}`, as.bureau)).json<{ version: number }>();
        // a published key never leaves the form: taken out, it is flagged removed (people no longer see or fill it)
        const without = {
            schemaVersion: 2,
            fields: [text('plate', true), { ...text('owner', true), removed: true }, text('remark')]
        };
        const saved = await api.call(
            'PATCH',
            `/api/v1/forms/${ids.form}`,
            as.bureau,
            { document: without },
            ifMatch(form.version)
        );
        expect(saved.statusCode, saved.body).toBe(200);
        {
            const check = await api.call('GET', `/api/v1/forms/${ids.form}/publish-check`, as.bureau);
            expect(check.statusCode, check.body).toBe(200);
            expect(check.json()).toMatchObject({
                canPublish: false,
                problems: expect.arrayContaining([
                    expect.objectContaining({ code: 'contract', fieldId: 'owner' })
                ]) as unknown,
                impact: { services: [{ code: SERVICE, openCases: 0, effects: ['test.issuePermit'] }] }
            });
            const asked = await api.call('POST', `/api/v1/forms/${ids.form}/publications`, as.bureau, {});
            expect(asked.statusCode).toBe(422);
            expect(asked.json<{ errors: { code: string; message: string }[] }>().errors).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'contract_unmet' })])
            );
            // back as it was
            const now = (await api.call('GET', `/api/v1/forms/${ids.form}`, as.bureau)).json<{ version: number }>();
            await api.call('PATCH', `/api/v1/forms/${ids.form}`, as.bureau, { document: FORM }, ifMatch(now.version));
        }
    });
});

describe('the effect', () => {
    it('is given its input by its contract, read from the request through the version’s input map', async () => {
        const started = await api.call('POST', '/api/v1/service-requests', as.damotRecords, {
            serviceCode: SERVICE,
            answers: { plate: 'ETH ABC 0042', owner: 'Generated Owner', remark: 'not read' }
        });
        expect(started.statusCode, started.body).toBe(201);
        let c = started.json<CaseOut>();
        for (const action of ['submit', 'issue']) {
            const res = await api.call(
                'POST',
                `/api/v1/cases/${c.id}/transitions`,
                as.damotRecords,
                { action },
                ifMatch(c.version)
            );
            expect(res.statusCode, res.body).toBe(200);
            c = res.json<CaseOut>();
        }
        const { rows } = await api.owner.query<{ facts: Record<string, unknown> }>(
            'select facts from workflow.cases where id = $1',
            [c.id]
        );
        expect(rows[0]?.facts.permit).toEqual({ plate: 'ETH ABC 0042', holder: 'Generated Owner' });
    });
});
