/**
 * Workflow definitions (task 0.19a), over HTTP on a real PostgreSQL 16: a definition is stored as an immutable version only
 * when the engine's checks pass (structure, roles, effects, step forms), with the problems in the reader's language; the
 * same content names the same version; the bureau's workflows are read below it and changed only where they are owned
 * (class C), never seen from a sibling zone or another region; every write is audited.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damot: '0199f0a0-d000-7000-8000-000000000202',
    tzbAdmin: '0199f0a0-d000-7000-8000-00000000f701',
    trxAdmin: '0199f0a0-d000-7000-8000-00000000f702'
};

/** A small valid workflow: an officer reviews, the zone's head approves (no effects: none is registered yet). */
const definition = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start' },
        { key: 'review', kind: 'task', assignee: { role: 'records_officer', unit: 'handling' } },
        {
            key: 'approval',
            kind: 'task',
            assignee: { role: 'unit_head', unit: 'parent' },
            separationOfDuties: ['review']
        },
        { key: 'done', kind: 'end' },
        { key: 'rejected', kind: 'end' }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'approval', action: 'approve' },
        { from: 'approval', to: 'done', action: 'approve' },
        {
            from: ['review', 'approval'],
            to: 'rejected',
            action: 'reject',
            rejectRoles: ['unit_head'],
            commentRequired: true
        }
    ],
    ...extra
});

interface Problem {
    code: string;
    errors: { path: string; code: string; message: string }[];
}
interface WorkflowOut {
    id: string;
    key: string;
    latestVersion: { id: string; number: number } | null;
}
interface VersionOut {
    id: string;
    number: number;
    contentHash: string;
    definition: Record<string, unknown>;
}

let pg: TestPostgres;
let api: TestApi;
let owner: Client;
const as = {} as Record<keyof typeof SUB, As>;
let counter = 0;
const keyOf = () => `workflow-${++counter}`;

const create = (who: As, body: Record<string, unknown>) => api.call('POST', '/api/v1/workflow-definitions', who, body);
const name = { am: 'የሙከራ ፍሰት', en: 'Test workflow' };

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        { username: 'test.tzb.admin', sub: SUB.tzbAdmin, region: 'SER', home: 'TZB', roles: [['TZB', 'unit_admin']] },
        {
            username: 'test.trx.records',
            sub: SUB.trxAdmin,
            region: 'TRX',
            home: 'TRX-W1',
            roles: [['TRX-W1', 'records_officer']]
        }
    ]);
    as.bureau = { sub: SUB.bureau, unit: await api.unit('SER', 'SER') };
    as.zoneAdmin = { sub: SUB.zoneAdmin, unit: await api.unit('SER', 'WOL') };
    as.damot = { sub: SUB.damot, unit: await api.unit('SER', 'WOL-DAMOT-GALE') };
    as.tzbAdmin = { sub: SUB.tzbAdmin, unit: await api.unit('SER', 'TZB') };
    as.trxAdmin = { sub: SUB.trxAdmin, unit: await api.unit('TRX', 'TRX-W1') };
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
}, 240_000);

afterAll(async () => {
    await owner?.end();
    await api?.close();
    await pg?.stop();
});

describe('storing a definition', () => {
    it('stores a valid one as version 1, readable with its versions', async () => {
        const res = await create(as.bureau, { key: keyOf(), name, definition: definition() });
        expect(res.statusCode, res.body).toBe(201);
        const wf = res.json<WorkflowOut>();
        expect(wf.latestVersion?.number).toBe(1);
        const versions = await api.call('GET', `/api/v1/workflow-definitions/${wf.id}/versions`, as.bureau);
        expect(versions.json<{ items: { number: number }[] }>().items.map((v) => v.number)).toEqual([1]);
        const v1 = await api.call(
            'GET',
            `/api/v1/workflow-definitions/${wf.id}/versions/${wf.latestVersion?.id}`,
            as.bureau
        );
        expect(v1.json<VersionOut>().definition).toEqual(definition());
    });

    it('refuses an unreachable state, no reachable end and unknown roles, effects and step forms, saying why', async () => {
        const bad = definition();
        bad.states.push({ key: 'orphan', kind: 'task', assignee: { role: 'competency.ghost', unit: 'handling' } }, {
            key: 'exam',
            kind: 'task',
            assignee: { role: 'records_officer', unit: 'handling' },
            stepForm: 'no-such-form@3'
        } as never);
        bad.transitions.push(
            { from: 'orphan', to: 'done', action: 'go' },
            { from: 'review', to: 'exam', action: 'examine' },
            { from: 'exam', to: 'done', action: 'pass', effects: ['competency.issueLicence'] } as never
        );
        const res = await create(as.bureau, { key: keyOf(), name, definition: bad });
        expect(res.statusCode, res.body).toBe(422);
        const errors = res.json<Problem>().errors;
        expect(errors).toEqual(
            expect.arrayContaining([
                {
                    path: 'definition.states[5]',
                    code: 'unreachable',
                    message: 'No transition leads to the state "orphan".'
                },
                {
                    path: 'definition.states[5].assignee.role',
                    code: 'unknown-role',
                    message: 'No installed module defines the role "competency.ghost".'
                },
                {
                    path: 'definition.states[6].stepForm',
                    code: 'unknown-step-form',
                    message: 'There is no form version "no-such-form@3".'
                },
                {
                    path: 'definition.transitions[6].effects[0]',
                    code: 'unknown-effect',
                    message: 'No installed module provides the effect "competency.issueLicence".'
                }
            ])
        );
        // nothing was stored
        const listed = await api.call('GET', `/api/v1/workflow-definitions?q=workflow-${counter}`, as.bureau);
        expect(listed.json<{ items: unknown[] }>().items).toEqual([]);
    });

    it('answers in Amharic too, and refuses a workflow that cannot end', async () => {
        const loop = definition({
            transitions: [
                { from: 'draft', to: 'review', action: 'submit' },
                { from: 'review', to: 'approval', action: 'approve' },
                { from: 'approval', to: 'review', action: 'return' }
            ]
        });
        const res = await api.call(
            'POST',
            '/api/v1/workflow-definitions/check',
            as.bureau,
            { definition: loop },
            {
                'accept-language': 'am'
            }
        );
        expect(res.statusCode, res.body).toBe(200);
        const check = res.json<{ ok: boolean; problems: { code: string; message: string }[] }>();
        expect(check.ok).toBe(false);
        expect(check.problems.filter((p) => p.code === 'dead-end').map((p) => p.message)).toContain(
            'በደረጃ "review" ያለ ጉዳይ ፈጽሞ ወደ ማጠናቀቂያ ሊደርስ አይችልም።'
        );
        expect(check.problems.map((p) => p.code)).toContain('unreachable');
    });

    it('knows a step form once its version exists', async () => {
        const form = await api.call('POST', '/api/v1/forms', as.bureau, {
            key: 'exam-result',
            name: { am: 'የፈተና ውጤት', en: 'Exam result' },
            document: { schemaVersion: 2, fields: [] }
        });
        expect(form.statusCode, form.body).toBe(201);
        // asking to publish snapshots version 1
        const asked = await api.call(
            'POST',
            `/api/v1/forms/${form.json<{ id: string }>().id}/publications`,
            as.bureau,
            {}
        );
        expect(asked.statusCode, asked.body).toBe(201);
        const withForm = definition();
        (withForm.states[1] as Record<string, unknown>).stepForm = 'exam-result@1';
        const check = await api.call('POST', '/api/v1/workflow-definitions/check', as.bureau, { definition: withForm });
        expect(check.json<{ ok: boolean }>()).toMatchObject({ ok: true });
        (withForm.states[1] as Record<string, unknown>).stepForm = 'exam-result@2';
        const missing = await api.call('POST', '/api/v1/workflow-definitions/check', as.bureau, {
            definition: withForm
        });
        expect(missing.json<{ problems: { code: string }[] }>().problems.map((p) => p.code)).toEqual([
            'unknown-step-form'
        ]);
    });

    it('refuses a key used in the region', async () => {
        const key = keyOf();
        expect((await create(as.bureau, { key, name, definition: definition() })).statusCode).toBe(201);
        const again = await create(as.bureau, { key, name, definition: definition() });
        expect(again.statusCode).toBe(409);
        expect(again.json<Problem>().code).toBe('duplicate_reference');
    });
});

describe('versions', () => {
    it('numbers new content, names the same content by its version, and goes back to an earlier one', async () => {
        const wf = (await create(as.bureau, { key: keyOf(), name, definition: definition() })).json<WorkflowOut>();
        const url = `/api/v1/workflow-definitions/${wf.id}/versions`;
        const same = await api.call('POST', url, as.bureau, { definition: definition() });
        expect(same.statusCode, same.body).toBe(201);
        expect(same.json<VersionOut>().number).toBe(1);
        const changed = definition();
        changed.transitions[3] = { ...changed.transitions[3], commentRequired: false } as never;
        const v2 = (await api.call('POST', url, as.bureau, { definition: changed })).json<VersionOut>();
        expect(v2.number).toBe(2);
        expect(
            (await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.bureau)).json<WorkflowOut>()
        ).toMatchObject({ latestVersion: { number: 2 } });
        // back to the first content: version 1 is the latest again, no third
        await api.call('POST', url, as.bureau, { definition: definition() });
        const back = (await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.bureau)).json<WorkflowOut>();
        expect(back.latestVersion?.number).toBe(1);
        expect((await api.call('GET', url, as.bureau)).json<{ items: unknown[] }>().items).toHaveLength(2);
    });

    it('never changes or removes a version, for the owner either', async () => {
        const wf = (await create(as.bureau, { key: keyOf(), name, definition: definition() })).json<WorkflowOut>();
        await expect(
            owner.query(`update workflow.workflow_definition_versions set number = 9 where id = $1`, [
                wf.latestVersion?.id
            ])
        ).rejects.toThrow(/immutable/);
        await expect(
            owner.query(`delete from workflow.workflow_definition_versions where id = $1`, [wf.latestVersion?.id])
        ).rejects.toThrow(/immutable/);
    });

    it('audits every write in its transaction, without the definition', async () => {
        const wf = (await create(as.bureau, { key: keyOf(), name, definition: definition() })).json<WorkflowOut>();
        const rows = (
            await owner.query<{ table_name: string; action: string; diff: Record<string, Record<string, unknown>> }>(
                `select table_name, action, diff from kernel.audit_log
                  where row_id in (select $1::uuid union all
                                   select id from workflow.workflow_definition_versions where definition_id = $1)
                  order by at, id`,
                [wf.id]
            )
        ).rows;
        expect(rows.map((r) => `${r.table_name}:${r.action}`)).toEqual([
            'workflow.workflow_definitions:insert',
            'workflow.workflow_definition_versions:insert',
            'workflow.workflow_definitions:update'
        ]);
        expect(rows[1]?.diff.after).toHaveProperty('contentHash');
        expect(rows[1]?.diff.after ?? {}).not.toHaveProperty('definition');
    });
});

describe('who sees and changes a workflow (class C)', () => {
    it('reads the bureau’s workflow below it, changes it only where it is owned', async () => {
        const wf = (await create(as.bureau, { key: keyOf(), name, definition: definition() })).json<WorkflowOut>();
        expect((await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.zoneAdmin)).statusCode).toBe(200);
        const changed = definition();
        changed.transitions[3] = { ...changed.transitions[3], commentRequired: false } as never;
        const res = await api.call('POST', `/api/v1/workflow-definitions/${wf.id}/versions`, as.zoneAdmin, {
            definition: changed
        });
        expect(res.statusCode).toBe(403);
    });

    it('keeps a zone’s workflow from a sibling zone, and from roles without the permission (the isolation matrix covers the policies)', async () => {
        const res = await create(as.zoneAdmin, { key: keyOf(), name, definition: definition() });
        expect(res.statusCode, res.body).toBe(201);
        const wf = res.json<WorkflowOut>();
        expect((await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.tzbAdmin)).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.bureau)).statusCode).toBe(200);
        // a records officer neither reads nor writes definitions
        expect((await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.damot)).statusCode).toBe(403);
        expect((await api.call('GET', `/api/v1/workflow-definitions/${wf.id}`, as.trxAdmin)).statusCode).toBe(403);
    });

    it('answers a malformed id with 400', async () => {
        expect((await api.call('GET', '/api/v1/workflow-definitions/not-a-uuid', as.bureau)).statusCode).toBe(400);
    });
});
