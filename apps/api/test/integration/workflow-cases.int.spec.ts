/**
 * Cases and transitions (task 0.19b), over HTTP on a real PostgreSQL 16: a test workflow runs end to end across the
 * Damot Gale woreda and the zone above it; the maker never approves their own step; a failing effect rolls everything
 * back; the zone approves for the woreda (its task opened in a unit above the actor's scope); a wait is left only by its
 * event or its timeout, taken by system actors; a one-person office's separated step goes to its parent, recorded on the
 * case; a cashier does not reject; tasks are seen by the assignee unit (and those above it) only.
 */
import { Injectable, Module } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { createDatabase, recordEvent, type Database, type DbContext } from '@itrms/kernel/db';
import { Effect, type EffectRun, type WorkflowEffect } from '@itrms/kernel/effects';
import { ConflictError } from '@itrms/kernel/errors';
import { CasesService } from '@itrms/workflow/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

@Injectable()
@Effect('test.markFact')
class MarkFact implements WorkflowEffect {
    run({ argument }: EffectRun) {
        return Promise.resolve({ facts: { marked: argument ?? true } });
    }
}

@Injectable()
@Effect('test.writeNote')
class WriteNote implements WorkflowEffect {
    async run({ tx, caseId }: EffectRun) {
        await recordEvent(tx, { type: 'test.effect.ran', data: { caseId } });
    }
}

@Injectable()
@Effect('test.fail')
class Fail implements WorkflowEffect {
    run(): Promise<void> {
        return Promise.reject(new ConflictError('invalid_transition', { detail: 'The test effect failed.' }));
    }
}

@Module({ providers: [MarkFact, WriteNote, Fail] })
class TestEffects {}

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    bureau2: '0199f0a0-d000-7000-8000-00000000f805',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotBoth: '0199f0a0-d000-7000-8000-00000000f801',
    damotCashier: '0199f0a0-d000-7000-8000-00000000f802',
    solo: '0199f0a0-d000-7000-8000-00000000f803',
    // demo.dual: a cashier at Boditi and the zone's only records officer
    zoneRecords: '0199f0a0-d000-7000-8000-000000000401',
    tzbAdmin: '0199f0a0-d000-7000-8000-00000000f804'
};

/** Review at the handling office, approval where the service says, payment, then the national platform's answer. */
const LICENCE = (effects: string[] = ['test.markFact:reviewed']) => ({
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start' },
        { key: 'review', kind: 'task', assignee: { role: 'records_officer', unit: 'handling' } },
        {
            key: 'approval',
            kind: 'task',
            assignee: { role: 'unit_head', unit: '${approval_unit}' },
            separationOfDuties: ['review']
        },
        { key: 'payment', kind: 'task', assignee: { role: 'cashier', unit: 'handling' } },
        { key: 'national', kind: 'wait', sla: { businessDays: 2 } },
        { key: 'done', kind: 'end' },
        { key: 'rejected', kind: 'end' }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'approval', action: 'approve', effects },
        { from: 'review', to: 'draft', action: 'return', commentRequired: true },
        { from: 'approval', to: 'payment', action: 'approve' },
        { from: 'payment', to: 'national', action: 'paid', effects: ['test.writeNote'] },
        {
            from: 'national',
            to: 'done',
            on: 'event:national.licence.accepted',
            actor: 'system:national-driver-platform'
        },
        { from: 'national', to: 'approval', on: 'timeout' },
        {
            from: ['review', 'approval', 'payment'],
            to: 'rejected',
            action: 'reject',
            rejectRoles: ['unit_head'],
            commentRequired: true
        }
    ]
});

interface CaseOut {
    id: string;
    version: number;
    state: string;
    closed: boolean;
    actions: string[];
    tasks: {
        state: string;
        role: string;
        unit: { code: string };
        status: string;
        routedFrom: { code: string } | null;
    }[];
    events: {
        kind: string;
        from: string | null;
        to: string | null;
        action: string | null;
        systemActor: string | null;
    }[];
    /** the step forms' answers (task 0.20b) */
    steps: { state: string; formId: string; formVersion: number; form: unknown; answers: Record<string, unknown> }[];
}
interface Problem {
    code: string;
    detail?: string;
    errors?: { path: string; code: string }[];
}

let pg: TestPostgres;
let api: TestApi;
let system: Database;
const as = {} as Record<keyof typeof SUB, As>;
const versions = {} as Record<'licence' | 'failing', string>;
let counter = 0;

/** Stores a workflow as the bureau and gives the id of its version. */
async function workflow(definition: unknown): Promise<string> {
    const res = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: `case-test-${++counter}`,
        name: { am: 'የሙከራ ፍሰት', en: 'Test workflow' },
        definition
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ latestVersion: { id: string } }>().latestVersion.id;
}

/** Starts a case as `who` in their unit (services do this from 0.21). */
async function start(who: As, versionId: string, config: Record<string, unknown> = {}): Promise<string> {
    const ctx: DbContext = {
        userId: await api.userId(who.sub),
        unitId: who.unit.id,
        regionId: who.unit.regionId,
        scopePath: who.unit.path
    };
    const db = api.http.get<Database>(DATABASE);
    const started = await db.scoped(ctx, (tx) =>
        api.http.get(CasesService).start(tx, ctx, { definitionVersionId: versionId, config })
    );
    return started.id;
}

const read = (who: As, id: string) => api.call('GET', `/api/v1/cases/${id}`, who);
const get = async (who: As, id: string) => {
    const res = await read(who, id);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
};

/** A transition as `who`, based on the version they read. */
async function act(who: As, id: string, action: string, body: Record<string, unknown> = {}) {
    const current = await read(who, id);
    const version = current.statusCode === 200 ? current.json<CaseOut>().version : 1;
    return api.call(
        'POST',
        `/api/v1/cases/${id}/transitions`,
        who,
        { action, ...body },
        { 'if-match': `"${version}"` }
    );
}
async function ok(who: As, id: string, action: string, body: Record<string, unknown> = {}): Promise<CaseOut> {
    const res = await act(who, id, action, body);
    expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    return res.json<CaseOut>();
}

/** An event or the timeout, delivered by a system actor in a system context (the worker's, in production). */
const deliver = (id: string, on: string, actor: string) =>
    system.scoped({ requestId: 'system:test' }, (tx) =>
        api.http.get(CasesService).deliver(tx, id, on, { kind: 'system', id: actor }, 'en')
    );

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.damot.both',
                sub: SUB.damotBoth,
                region: 'SER',
                home: 'WOL-DAMOT-GALE',
                roles: [
                    ['WOL-DAMOT-GALE', 'records_officer'],
                    ['WOL-DAMOT-GALE', 'unit_head']
                ]
            },
            {
                username: 'test.damot.cashier',
                sub: SUB.damotCashier,
                region: 'SER',
                home: 'WOL-DAMOT-GALE',
                roles: [['WOL-DAMOT-GALE', 'cashier']]
            },
            {
                username: 'test.humbo.solo',
                sub: SUB.solo,
                region: 'SER',
                home: 'WOL-HUMBO',
                roles: [
                    ['WOL-HUMBO', 'records_officer'],
                    ['WOL-HUMBO', 'unit_head']
                ]
            },
            {
                username: 'test.bureau.admin2',
                sub: SUB.bureau2,
                region: 'SER',
                home: 'SER',
                roles: [['SER', 'bureau_admin']]
            },
            { username: 'test.tzb.head', sub: SUB.tzbAdmin, region: 'SER', home: 'TZB', roles: [['TZB', 'unit_head']] }
        ],
        { modules: [TestEffects] }
    );
    system = createDatabase(pg.url('system'));
    const ser = await api.unit('SER', 'SER');
    const wol = await api.unit('SER', 'WOL');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: ser };
    as.bureau2 = { sub: SUB.bureau2, unit: ser };
    as.zoneHead = { sub: SUB.zoneHead, unit: wol };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.damotBoth = { sub: SUB.damotBoth, unit: damot };
    as.damotCashier = { sub: SUB.damotCashier, unit: damot };
    as.solo = { sub: SUB.solo, unit: await api.unit('SER', 'WOL-HUMBO') };
    as.zoneRecords = { sub: SUB.zoneRecords, unit: wol };
    as.tzbAdmin = { sub: SUB.tzbAdmin, unit: await api.unit('SER', 'TZB') };
    versions.licence = await workflow(LICENCE());
    versions.failing = await workflow(LICENCE(['test.markFact:reviewed', 'test.writeNote', 'test.fail']));
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('a case end to end', () => {
    it('runs from the woreda to the zone and back, and ends on the national platform’s answer', async () => {
        const id = await start(as.damotRecords, versions.licence, { approval_unit: 'parent' });
        expect((await get(as.damotRecords, id)).actions).toEqual(['submit']);
        // only whoever started it acts in the start
        expect((await act(as.damotCashier, id, 'submit')).statusCode).toBe(403);
        let c = await ok(as.damotRecords, id, 'submit');
        expect(c.state).toBe('review');
        c = await ok(as.damotRecords, id, 'approve');
        expect(c.state).toBe('approval');

        // the zone approves for the woreda: its task is the zone's, and the woreda does not see it
        const zone = await get(as.zoneHead, id);
        expect(zone.tasks.find((t) => t.status === 'open')).toMatchObject({
            state: 'approval',
            role: 'unit_head',
            unit: { code: 'WOL' }
        });
        expect(zone.actions).toEqual(expect.arrayContaining(['approve', 'reject']));
        expect(c.tasks.map((t) => t.state)).toEqual(['review']);
        expect((await act(as.damotHead, id, 'approve')).statusCode).toBe(403);
        c = await ok(as.zoneHead, id, 'approve');
        expect(c.state).toBe('payment');

        // a cashier pays, and does not reject
        const reject = await act(as.damotCashier, id, 'reject', { comment: 'No' });
        expect(reject.statusCode, reject.body).toBe(403);
        c = await ok(as.damotCashier, id, 'paid');
        expect(c.state).toBe('national');

        // a wait is left by its event only: not by a person, not by another system
        expect((await act(as.damotRecords, id, 'approve')).statusCode).toBe(409);
        await expect(deliver(id, 'event:national.licence.accepted', 'system:sms')).rejects.toMatchObject({
            status: 403
        });
        await expect(deliver(id, 'timeout', 'system:national-driver-platform')).rejects.toMatchObject({
            status: 403
        });
        expect(await deliver(id, 'event:national.licence.accepted', 'system:national-driver-platform')).toEqual({
            from: 'national',
            to: 'done'
        });
        const done = await get(as.damotRecords, id);
        expect(done).toMatchObject({ state: 'done', closed: true, actions: [] });
        expect(done.events.map((e) => [e.kind, e.from, e.to, e.action, e.systemActor])).toEqual([
            ['started', null, 'draft', null, null],
            ['transition', 'draft', 'review', 'submit', null],
            ['transition', 'review', 'approval', 'approve', null],
            ['transition', 'approval', 'payment', 'approve', null],
            ['transition', 'payment', 'national', 'paid', null],
            ['transition', 'national', 'done', 'event:national.licence.accepted', 'system:national-driver-platform']
        ]);
        expect((await act(as.damotRecords, id, 'submit')).statusCode).toBe(409);

        // every write audited in its transaction, the effects' own work included
        const audit = await api.owner.query<{ table_name: string | null; event_type: string | null }>(
            `select table_name, event_type from kernel.audit_log
              where (row_id = $1::uuid) or (diff ->> 'caseId' = $1::text) or (event_type = 'test.effect.ran')
              order by at, id`,
            [id]
        );
        const kinds = audit.rows.flatMap((r) => [r.table_name, r.event_type]).filter(Boolean);
        expect(kinds).toEqual(expect.arrayContaining(['workflow.cases', 'workflow.task.opened', 'test.effect.ran']));
    });

    it('leaves a wait by its timeout, taken by the timer', async () => {
        const id = await start(as.damotRecords, versions.licence, { approval_unit: 'parent' });
        await ok(as.damotRecords, id, 'submit');
        await ok(as.damotRecords, id, 'approve');
        await ok(as.zoneHead, id, 'approve');
        await ok(as.damotCashier, id, 'paid');
        expect(await deliver(id, 'timeout', 'system:timer')).toEqual({ from: 'national', to: 'approval' });
        expect((await get(as.zoneHead, id)).tasks.filter((t) => t.status === 'open')).toHaveLength(1);
    });

    it('asks for a comment where one is required, and for the version the actor read', async () => {
        const id = await start(as.damotRecords, versions.licence, { approval_unit: 'parent' });
        await ok(as.damotRecords, id, 'submit');
        const res = await act(as.damotRecords, id, 'return');
        expect(res.statusCode).toBe(422);
        expect(res.json<Problem>().errors?.[0]).toMatchObject({ path: 'comment', code: 'required' });
        const stale = await api.call(
            'POST',
            `/api/v1/cases/${id}/transitions`,
            as.damotRecords,
            { action: 'approve' },
            { 'if-match': '"1"' }
        );
        expect(stale.statusCode).toBe(409);
        expect(stale.json<Problem>().code).toBe('stale_version');
        expect((await ok(as.damotRecords, id, 'return', { comment: 'The photo is missing' })).state).toBe('draft');
    });
});

describe('separation of duties', () => {
    it('keeps the maker off their own approval', async () => {
        const id = await start(as.damotBoth, versions.licence, { approval_unit: 'handling' });
        await ok(as.damotBoth, id, 'submit');
        await ok(as.damotBoth, id, 'approve');
        // the head who reviewed it does not approve it; the woreda's other head does
        const own = await act(as.damotBoth, id, 'approve');
        expect(own.statusCode, own.body).toBe(403);
        expect((await ok(as.damotHead, id, 'approve')).state).toBe('payment');
    });

    it('sends a one-person office’s separated step to its parent, recorded on the case', async () => {
        const id = await start(as.solo, versions.licence, { approval_unit: 'handling' });
        await ok(as.solo, id, 'submit');
        await ok(as.solo, id, 'approve');
        const zone = await get(as.zoneHead, id);
        expect(zone.tasks.find((t) => t.status === 'open')).toMatchObject({
            state: 'approval',
            unit: { code: 'WOL' },
            routedFrom: { code: 'WOL-HUMBO' }
        });
        expect(zone.events.at(-1)).toMatchObject({ kind: 'routed', from: 'approval', to: 'approval' });
        expect((await act(as.solo, id, 'approve')).statusCode).toBe(403);
        expect((await ok(as.zoneHead, id, 'approve')).state).toBe('payment');
    });
});

describe('step forms', () => {
    it('files the answers on the case, on the version the step names (approved, though no longer published)', async () => {
        // a form with a required field, approved as version 1, then version 2 published over it
        const created = await api.call('POST', '/api/v1/forms', as.bureau, {
            key: 'review-checklist',
            name: { am: 'የማጣሪያ ዝርዝር', en: 'Review checklist' },
            document: {
                schemaVersion: 2,
                fields: [
                    {
                        id: 'photo',
                        type: 'InputText',
                        label: { am: 'ፎቶ', en: 'Photo' },
                        props: { required: true },
                        behavior: { validation: { supported: true } }
                    }
                ]
            }
        });
        expect(created.statusCode, created.body).toBe(201);
        const formId = created.json<{ id: string }>().id;
        const publish = async () => {
            const asked = (await api.call('POST', `/api/v1/forms/${formId}/publications`, as.bureau, {})).json<{
                id: string;
                version: number;
            }>();
            const approved = await api.call(
                'POST',
                `/api/v1/form-publications/${asked.id}/approval`,
                as.bureau2,
                {},
                { 'if-match': `"${asked.version}"` }
            );
            expect(approved.statusCode, approved.body).toBe(200);
        };
        await publish();
        const def = LICENCE();
        (def.states[1] as Record<string, unknown>).stepForm = 'review-checklist@1';
        const versionId = await workflow(def);
        const form = (await api.call('GET', `/api/v1/forms/${formId}`, as.bureau)).json<{ version: number }>();
        const changed = await api.call(
            'PATCH',
            `/api/v1/forms/${formId}`,
            as.bureau,
            {
                document: {
                    schemaVersion: 2,
                    fields: [
                        {
                            id: 'photo',
                            type: 'InputText',
                            label: { am: 'ፎቶ', en: 'Photo' },
                            props: { required: true },
                            behavior: { validation: { supported: true } }
                        },
                        { id: 'note', type: 'InputText', label: { am: 'ማስታወሻ', en: 'Note' }, props: {} }
                    ]
                }
            },
            { 'if-match': `"${form.version}"` }
        );
        expect(changed.statusCode, changed.body).toBe(200);
        // version 2 is the published one now; the workflow keeps naming version 1
        await publish();

        const id = await start(as.damotRecords, versionId, { approval_unit: 'parent' });
        await ok(as.damotRecords, id, 'submit');
        const missing = await act(as.damotRecords, id, 'approve');
        expect(missing.statusCode, missing.body).toBe(422);
        expect(missing.json<Problem>().errors?.[0]).toMatchObject({ path: 'answers', code: 'required' });
        const invalid = await act(as.damotRecords, id, 'approve', { answers: {} });
        expect(invalid.statusCode, invalid.body).toBe(422);
        expect(invalid.json<Problem>().errors?.map((e) => e.path)).toContain('photo');
        // sending it back for correction takes no form
        expect((await ok(as.damotRecords, id, 'return', { comment: 'Again' })).state).toBe('draft');
        await ok(as.damotRecords, id, 'submit');
        expect((await ok(as.damotRecords, id, 'approve', { answers: { photo: 'front.jpg' } })).state).toBe('approval');
        const filed = await api.owner.query<{ case_id: string; handling: string; number: number }>(
            `select s.case_id, s.handling_unit_id as handling, v.number from forms.submissions s
               join forms.form_versions v on v.id = s.form_version_id where s.case_id = $1::uuid`,
            [id]
        );
        expect(filed.rows).toEqual([{ case_id: id, handling: as.damotRecords.unit.id, number: 1 }]);
        // the case page shows them as the review's answers, on the version they were filled on (task 0.20b)
        const page = await get(as.damotRecords, id);
        expect(page.steps).toHaveLength(1);
        expect(page.steps[0]).toMatchObject({
            state: 'review',
            formId,
            formVersion: 1,
            answers: { photo: 'front.jpg' }
        });
        expect(page.steps[0]?.form).toMatchObject({ fields: [{ id: 'photo' }] });
        expect(page.events.find((e) => e.from === 'review' && e.action === 'approve')).toBeDefined();
    });
});

describe('nobody eligible', () => {
    it('refuses a step nobody up to the region may take, as a configuration problem (409, not a denial)', async () => {
        // Humbo's solo officer reviews, the zone's records officer reviews again, and the approval is kept apart from both:
        // records officers are only those two, up to the region
        const def = LICENCE();
        def.states.splice(2, 0, {
            key: 'zone_review',
            kind: 'task',
            assignee: { role: 'records_officer', unit: 'parent' }
        } as never);
        (def.states[3] as Record<string, unknown>).assignee = { role: 'records_officer', unit: 'handling' };
        (def.states[3] as Record<string, unknown>).separationOfDuties = ['review', 'zone_review'];
        def.transitions[1] = { from: 'review', to: 'zone_review', action: 'approve' };
        def.transitions.push({ from: 'zone_review', to: 'approval', action: 'approve' });
        const versionId = await workflow(def);
        const id = await start(as.solo, versionId);
        await ok(as.solo, id, 'submit');
        await ok(as.solo, id, 'approve');
        const res = await act(as.zoneRecords, id, 'approve');
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json<Problem>().detail).toContain('Nobody in this office or above it');
        expect((await get(as.zoneRecords, id)).state).toBe('zone_review');
    });
});

describe('effects', () => {
    it('rolls the whole transition back when one fails', async () => {
        const id = await start(as.damotRecords, versions.failing, { approval_unit: 'parent' });
        await ok(as.damotRecords, id, 'submit');
        const before = await get(as.damotRecords, id);
        const res = await act(as.damotRecords, id, 'approve');
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json<Problem>().detail).toBe('The test effect failed.');
        const after = await get(as.damotRecords, id);
        expect(after).toMatchObject({ state: 'review', version: before.version });
        expect(after.events).toHaveLength(before.events.length);
        expect(after.tasks.find((t) => t.status === 'open')).toMatchObject({ state: 'review' });
        // the effects that ran before the failure left nothing behind
        const ran = await api.owner.query(
            `select 1 from kernel.audit_log where event_type = 'test.effect.ran' and diff ->> 'caseId' = $1::text`,
            [id]
        );
        expect(ran.rowCount).toBe(0);
    });
});

describe('who sees a case', () => {
    it('is not found from a sibling zone, and its tasks are seen by their unit and those above it', async () => {
        const id = await start(as.damotRecords, versions.licence, { approval_unit: 'parent' });
        await ok(as.damotRecords, id, 'submit');
        await ok(as.damotRecords, id, 'approve');
        // Test Zone B's head may read cases, but not this one (RLS: another zone's subtree)
        expect((await read(as.tzbAdmin, id)).statusCode).toBe(404);
        // the zone's approval task: the zone sees it, the woreda below does not
        expect((await get(as.zoneHead, id)).tasks.map((t) => t.state)).toEqual(['review', 'approval']);
        expect((await get(as.damotRecords, id)).tasks.map((t) => t.state)).toEqual(['review']);
    });

    it('answers a malformed id with 400', async () => {
        expect((await read(as.damotRecords, 'not-a-uuid')).statusCode).toBe(400);
    });
});
