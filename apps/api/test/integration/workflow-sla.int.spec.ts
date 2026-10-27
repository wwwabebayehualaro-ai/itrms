/**
 * SLA timers and notifications (task 0.20a), on a real PostgreSQL 16: a step's due time comes from its SLA on its unit's
 * calendar, with a timer event the relay hands over at that time; an overdue step is marked and its office's head told,
 * the office above too, nobody else; a wait past its SLA leaves by its timeout; a unit's own working week applies; a
 * person reads and marks only their own notifications.
 */
import { DATABASE } from '@itrms/kernel/api';
import type { Database, DbContext } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { FakeSms } from '@itrms/kernel/notifications';
import { CasesService } from '@itrms/workflow/api';
import { slaSweep, workflowHandlers, type SlaDeps } from '@itrms/workflow/api/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202'
};

/** A review timed in business hours, then a wait timed in business days that expires the case. */
const TIMED = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start' },
        {
            key: 'review',
            kind: 'task',
            assignee: { role: 'records_officer', unit: 'handling' },
            sla: { businessHours: 1 }
        },
        { key: 'national', kind: 'wait', sla: { businessDays: 1 } },
        { key: 'done', kind: 'end' },
        { key: 'expired', kind: 'end' }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'national', action: 'approve' },
        {
            from: 'national',
            to: 'done',
            on: 'event:national.licence.accepted',
            actor: 'system:national-driver-platform'
        },
        { from: 'national', to: 'expired', on: 'timeout' }
    ]
};

interface CaseOut {
    id: string;
    version: number;
    state: string;
}
interface Note {
    id: string;
    key: string;
    text: Record<string, string>;
    link: { caseId: string } | null;
    read: boolean;
}

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let deps: SlaDeps;
let sms: FakeSms;
let versionId: string;
const as = {} as Record<keyof typeof SUB, As>;

async function start(who: As): Promise<string> {
    const ctx: DbContext = {
        userId: await api.userId(who.sub),
        unitId: who.unit.id,
        regionId: who.unit.regionId,
        scopePath: who.unit.path
    };
    return (
        await api.http
            .get<Database>(DATABASE)
            .scoped(ctx, (tx) => api.http.get(CasesService).start(tx, ctx, { definitionVersionId: versionId }))
    ).id;
}
async function act(who: As, id: string, action: string) {
    const current = (await api.call('GET', `/api/v1/cases/${id}`, who)).json<CaseOut>();
    const res = await api.call(
        'POST',
        `/api/v1/cases/${id}/transitions`,
        who,
        { action },
        { 'if-match': `"${current.version}"` }
    );
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}
const notes = async (who: As) =>
    (await api.call('GET', '/api/v1/me/notifications', who)).json<{ items: Note[] }>().items;
/** The Addis Ababa weekday and time of an instant. */
const addis = (d: Date) => {
    const local = new Date(d.getTime() + 3 * 3600_000);
    return { weekday: local.getUTCDay(), time: local.toISOString().slice(11, 16) };
};

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    sms = new FakeSms();
    deps = { cases: api.http.get(CasesService), sms };
    const wol = await api.unit('SER', 'WOL');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.bureau = { sub: SUB.bureau, unit: await api.unit('SER', 'SER') };
    as.zoneHead = { sub: SUB.zoneHead, unit: wol };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    const res = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'timed',
        name: { am: 'የጊዜ ገደብ ያለው', en: 'Timed' },
        definition: TIMED
    });
    expect(res.statusCode, res.body).toBe(201);
    versionId = res.json<{ latestVersion: { id: string } }>().latestVersion.id;
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('due times', () => {
    it('gives a step its SLA on the civil service week, and a timer event available at that time', async () => {
        const id = await start(as.damotRecords);
        await act(as.damotRecords, id, 'submit');
        const task = (
            await api.owner.query<{ id: string; due_at: Date }>(
                `select id, due_at from workflow.case_tasks where case_id = $1::uuid and status = 'open'`,
                [id]
            )
        ).rows[0];
        expect(task?.due_at).toBeInstanceOf(Date);
        const { weekday, time } = addis(task?.due_at ?? new Date(0));
        expect(weekday).toBeGreaterThanOrEqual(1);
        expect(weekday).toBeLessThanOrEqual(5);
        expect(time >= '08:30' && time <= '17:30' && !(time > '12:30' && time < '13:30')).toBe(true);
        const timer = await api.owner.query<{ available_at: Date }>(
            `select available_at from kernel.outbox_events where type = 'case-task.due.v1' and payload ->> 'taskId' = $1`,
            [task?.id]
        );
        expect(timer.rows[0]?.available_at.getTime()).toBe(task?.due_at.getTime());
    });

    it('follows a unit’s own working week and holidays', async () => {
        const damot = as.damotRecords.unit;
        // Damot Gale works Saturdays 08:00–09:00 only (a test calendar)
        await api.owner.query(
            `insert into workflow.working_calendars (id, region_id, unit_id, week, half_days)
             values (gen_random_uuid(), $1, $2, '{"6": [["08:00", "09:00"]]}', '{}')`,
            [damot.regionId, damot.id]
        );
        try {
            const id = await start(as.damotRecords);
            await act(as.damotRecords, id, 'submit');
            const due = (
                await api.owner.query<{ due_at: Date }>(
                    `select due_at from workflow.case_tasks where case_id = $1::uuid and status = 'open'`,
                    [id]
                )
            ).rows[0]?.due_at;
            // one business hour of a Saturday 08:00–09:00 week ends at 09:00 on a Saturday
            expect(addis(due ?? new Date(0))).toEqual({ weekday: 6, time: '09:00' });
        } finally {
            await api.owner.query(`delete from workflow.working_calendars where unit_id = $1`, [damot.id]);
        }
    });
});

describe('an overdue step', () => {
    it('is marked, and tells its office’s head and the office above, nobody else, once', async () => {
        const id = await start(as.damotRecords);
        await act(as.damotRecords, id, 'submit');
        await api.owner.query(
            `update workflow.case_tasks set due_at = now() - interval '1 minute' where case_id = $1::uuid and status = 'open'`,
            [id]
        );
        expect(await slaSweep(system, deps)).toBeGreaterThanOrEqual(1);
        const task = await api.owner.query<{ overdue_at: Date | null }>(
            `select overdue_at from workflow.case_tasks where case_id = $1::uuid and status = 'open'`,
            [id]
        );
        expect(task.rows[0]?.overdue_at).toBeInstanceOf(Date);

        const head = (await notes(as.damotHead)).filter((n) => n.link?.caseId === id);
        expect(head).toHaveLength(1);
        expect(head[0]).toMatchObject({ key: 'workflow.notify.overdue', read: false });
        expect(head[0]?.text.en).toContain('the step "review" in your office is overdue');
        expect(head[0]?.text.am).toContain('review');
        const zone = (await notes(as.zoneHead)).filter((n) => n.link?.caseId === id);
        expect(zone.map((n) => n.key)).toEqual(['workflow.notify.escalated']);
        // the officer who holds the step is not a supervisor: told nothing
        expect((await notes(as.damotRecords)).filter((n) => n.link?.caseId === id)).toEqual([]);
        expect(sms.sent.some((m) => m.text.includes('is overdue'))).toBe(true);

        // marked read by its reader only
        const other = await api.call('POST', '/api/v1/me/notifications/read', as.zoneHead, { ids: [head[0]?.id] });
        expect(other.json<{ marked: number }>().marked).toBe(0);
        const mine = await api.call('POST', '/api/v1/me/notifications/read', as.damotHead, { ids: [head[0]?.id] });
        expect(mine.json<{ marked: number }>().marked).toBe(1);
        expect((await notes(as.damotHead)).find((n) => n.id === head[0]?.id)?.read).toBe(true);

        // the timer arriving later, or the next sweep, finds nothing to do
        const before = (await notes(as.damotHead)).length;
        await slaSweep(system, deps);
        expect((await notes(as.damotHead)).length).toBe(before);
    });

    it('is out of the API’s reach except through the reviewed functions', async () => {
        const grants = await api.owner.query(
            `select 1 from information_schema.role_table_grants
              where grantee = 'itrms_app' and table_schema = 'kernel' and table_name = 'notifications'`
        );
        expect(grants.rowCount).toBe(0);
        // only the scope columns a unit move rewrites: never a message
        const columns = await api.owner.query<{ column_name: string; privilege_type: string }>(
            `select column_name, privilege_type from information_schema.column_privileges
              where grantee = 'itrms_app' and table_schema = 'kernel' and table_name = 'notifications'
              order by column_name, privilege_type`
        );
        expect(columns.rows.map((r) => `${r.privilege_type} ${r.column_name}`)).toEqual([
            'SELECT org_path',
            'UPDATE org_path',
            'SELECT region_id'
        ]);
    });
});

describe('a wait past its SLA', () => {
    it('leaves by its timeout, taken by the timer, when its timer event arrives', async () => {
        const id = await start(as.damotRecords);
        await act(as.damotRecords, id, 'submit');
        expect((await act(as.damotRecords, id, 'approve')).state).toBe('national');
        const timer = await api.owner.query<{ id: string; payload: unknown }>(
            `select id, payload from kernel.outbox_events where type = 'case.wait-due.v1' and payload ->> 'caseId' = $1`,
            [id]
        );
        expect(timer.rowCount).toBe(1);
        // not yet due: the handler leaves it
        const handle = workflowHandlers(system, deps)['case.wait-due.v1'];
        await handle?.({ eventId: timer.rows[0]?.id ?? '', type: 'case.wait-due.v1', payload: timer.rows[0]?.payload });
        expect((await api.call('GET', `/api/v1/cases/${id}`, as.damotRecords)).json<CaseOut>().state).toBe('national');
        // due: the timeout moves it
        await api.owner.query(`update workflow.cases set due_at = now() - interval '1 minute' where id = $1::uuid`, [
            id
        ]);
        await handle?.({ eventId: timer.rows[0]?.id ?? '', type: 'case.wait-due.v1', payload: timer.rows[0]?.payload });
        const after = (await api.call('GET', `/api/v1/cases/${id}`, as.damotRecords)).json<
            CaseOut & {
                events: { action: string | null; systemActor: string | null }[];
            }
        >();
        expect(after.state).toBe('expired');
        expect(after.events.at(-1)).toMatchObject({ action: 'timeout', systemActor: 'system:timer' });
        const due = await api.owner.query<{ due_at: Date | null }>(
            `select due_at from workflow.cases where id = $1::uuid`,
            [id]
        );
        expect(due.rows[0]?.due_at).toBeNull();
    });
});
