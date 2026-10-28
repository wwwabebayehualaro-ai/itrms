/**
 * The inbox, claims and comments (task 0.20b), on a real PostgreSQL 16: intake starts a case; the inbox lists only the
 * open steps of the caller's unit for the roles they hold there (by due time, a page at a time, with its filters); one
 * of the role's holders takes a step on and the others may not act on it; separation of duties marks a step the caller
 * may not take; a comment's mentions must work on the case and are told once by the worker; all of it audited, and
 * nothing of it reaches another office.
 */
import { tellMentioned } from '@itrms/workflow/api/worker';
import type { CaseOut, Inbox } from '@itrms/workflow/contracts';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    zoneAuditor: '0199f0a0-d000-7000-8000-000000000109',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotRecords2: '0199f0a0-e200-7000-8000-000000000001',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    boditiHead: '0199f0a0-d000-7000-8000-000000000301'
};

/** A review timed in business hours, then an approval kept apart from the reviewer, both by Damot's records officers. */
const REVIEWED = {
    schemaVersion: 1,
    states: [
        { key: 'draft', kind: 'start', label: { am: 'ረቂቅ', en: 'Draft' } },
        {
            key: 'review',
            kind: 'task',
            label: { am: 'ማጣራት', en: 'Review' },
            assignee: { role: 'records_officer', unit: 'handling' },
            sla: { businessHours: 8 }
        },
        {
            key: 'approval',
            kind: 'task',
            label: { am: 'ማጽደቅ', en: 'Approval' },
            assignee: { role: 'records_officer', unit: 'handling' },
            separationOfDuties: ['review']
        },
        { key: 'done', kind: 'end', label: { am: 'ተጠናቋል', en: 'Done' } }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit' },
        { from: 'review', to: 'approval', action: 'forward', label: { am: 'አስተላልፍ', en: 'Forward' } },
        { from: 'review', to: 'draft', action: 'return', commentRequired: true },
        { from: 'approval', to: 'done', action: 'approve' }
    ]
};

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let workflowId: string;
const as = {} as Record<keyof typeof SUB, As>;

async function start(who: As = as.damotRecords): Promise<CaseOut> {
    const res = await api.call('POST', '/api/v1/cases', who, { workflowId });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<CaseOut>();
}
const get = async (who: As, id: string) => {
    const res = await api.call('GET', `/api/v1/cases/${id}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
};
async function act(who: As, id: string, action: string, body: Record<string, unknown> = {}) {
    const current = await get(as.damotRecords, id);
    return api.call(
        'POST',
        `/api/v1/cases/${id}/transitions`,
        who,
        { action, ...body },
        { 'if-match': `"${current.version}"` }
    );
}
const inbox = async (who: As, query = '') => {
    const res = await api.call('GET', `/api/v1/me/tasks${query}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Inbox>();
};
const claim = (who: As, c: CaseOut, release = false) => {
    const task = c.tasks.find((t) => t.status === 'open');
    return api.call('POST', `/api/v1/cases/${c.id}/tasks/${task?.id ?? ''}/${release ? 'release' : 'claim'}`, who);
};
/** A case submitted into its review. */
async function submitted(): Promise<CaseOut> {
    const c = await start();
    const res = await act(as.damotRecords, c.id, 'submit');
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CaseOut>();
}
const notes = async (who: As) =>
    (await api.call('GET', '/api/v1/me/notifications', who)).json<{
        items: { key: string; link: Record<string, string> | null; text: Record<string, string> }[];
    }>().items;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, [
        {
            username: 'test.damot.records2',
            sub: SUB.damotRecords2,
            region: 'SER',
            home: 'WOL-DAMOT-GALE',
            roles: [['WOL-DAMOT-GALE', 'records_officer']]
        }
    ]);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const wol = await api.unit('SER', 'WOL');
    const damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    const boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: await api.unit('SER', 'SER') };
    as.zoneHead = { sub: SUB.zoneHead, unit: wol };
    as.zoneAuditor = { sub: SUB.zoneAuditor, unit: wol };
    as.damotHead = { sub: SUB.damotHead, unit: damot };
    as.damotRecords = { sub: SUB.damotRecords, unit: damot };
    as.damotRecords2 = { sub: SUB.damotRecords2, unit: damot };
    as.boditiRecords = { sub: SUB.boditiRecords, unit: boditi };
    as.boditiHead = { sub: SUB.boditiHead, unit: boditi };
    const res = await api.call('POST', '/api/v1/workflow-definitions', as.bureau, {
        key: 'reviewed',
        name: { am: 'የሚጣራ', en: 'Reviewed' },
        definition: REVIEWED
    });
    expect(res.statusCode, res.body).toBe(201);
    workflowId = res.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

describe('starting a case', () => {
    it('is intake: a records officer starts one in their office; a head may not; an unknown workflow is 404', async () => {
        const c = await start();
        expect(c).toMatchObject({
            state: 'draft',
            handlingUnit: { id: as.damotRecords.unit.id },
            workflow: { id: workflowId, name: { en: 'Reviewed' } },
            stateLabels: { review: { en: 'Review' } },
            actionDetails: [{ action: 'submit', commentRequired: false, needsForm: false }],
            canComment: true
        });
        expect(c.startedByName).toBe('Damot Gale Records Officer (demo)');
        expect((await api.call('POST', '/api/v1/cases', as.damotHead, { workflowId })).statusCode).toBe(403);
        const unknown = await api.call('POST', '/api/v1/cases', as.damotRecords, {
            workflowId: '0199f0a0-0000-7000-8000-00000000beef'
        });
        expect(unknown.statusCode).toBe(404);
    });
});

describe('the inbox', () => {
    it("lists only the open steps of the caller's unit for their roles, with the SLA state", async () => {
        const c = await submitted();
        const mine = (await inbox(as.damotRecords)).items.find((i) => i.caseId === c.id);
        expect(mine).toMatchObject({
            caseNumber: c.number,
            state: 'review',
            stateLabel: { en: 'Review' },
            role: 'records_officer',
            unit: { id: as.damotRecords.unit.id },
            sla: 'on-time',
            claimedBy: null,
            mayAct: true,
            workflow: { name: { en: 'Reviewed' } }
        });
        expect(mine?.dueAt).toEqual(expect.any(String));
        // the other records officer of the office sees it too
        expect((await inbox(as.damotRecords2)).items.map((i) => i.caseId)).toContain(c.id);
        // another role in the office, the office above, and a sibling office do not
        for (const who of [as.damotHead, as.zoneHead, as.boditiRecords])
            expect((await inbox(who)).items.map((i) => i.caseId)).not.toContain(c.id);
        // a reader who acts on no case has no inbox
        expect((await api.call('GET', '/api/v1/me/tasks', as.zoneAuditor)).statusCode).toBe(403);
    });

    it('puts the overdue first, filters, and pages with a cursor', async () => {
        const late = await submitted();
        const soon = await submitted();
        await api.owner.query(
            `update workflow.case_tasks set due_at = now() - interval '1 hour' where case_id = $1::uuid and status = 'open'`,
            [late.id]
        );
        await api.owner.query(
            `update workflow.case_tasks set due_at = now() + interval '1 hour' where case_id = $1::uuid and status = 'open'`,
            [soon.id]
        );
        const all = (await inbox(as.damotRecords)).items;
        expect(all[0]).toMatchObject({ caseId: late.id, sla: 'overdue' });
        expect(all.find((i) => i.caseId === soon.id)?.sla).toBe('due-soon');
        expect((await inbox(as.damotRecords, '?sla=overdue')).items.map((i) => i.caseId)).toEqual([late.id]);
        expect((await inbox(as.damotRecords, '?sla=due-soon')).items.map((i) => i.caseId)).toEqual([soon.id]);
        expect((await inbox(as.damotRecords, `?number=${soon.number}`)).items.map((i) => i.caseId)).toEqual([soon.id]);

        // a page at a time: every task once, in the same order
        const seen: string[] = [];
        let after: string | null = null;
        do {
            const page: Inbox = await inbox(as.damotRecords, `?limit=1${after ? `&after=${after}` : ''}`);
            seen.push(...page.items.map((i) => i.taskId));
            after = page.nextCursor;
        } while (after);
        expect(seen).toEqual(all.map((i) => i.taskId));
        expect((await api.call('GET', '/api/v1/me/tasks?sort=due', as.damotRecords)).statusCode).toBe(400);
    });
});

describe('a claim', () => {
    it("makes a step one holder's: the others see whose it is and may not act on it until it is given back", async () => {
        const c = await submitted();
        const claimed = await claim(as.damotRecords, c);
        expect(claimed.statusCode, claimed.body).toBe(200);
        expect(claimed.json<CaseOut>().tasks.find((t) => t.status === 'open')?.claimedBy).toMatchObject({
            name: 'Damot Gale Records Officer (demo)'
        });
        // again: a no-op
        expect((await claim(as.damotRecords, c)).statusCode).toBe(200);
        const other = (await inbox(as.damotRecords2)).items.find((i) => i.caseId === c.id);
        expect(other?.claimedBy?.name).toBe('Damot Gale Records Officer (demo)');
        expect((await inbox(as.damotRecords2, '?claim=unclaimed')).items.map((i) => i.caseId)).not.toContain(c.id);
        expect((await inbox(as.damotRecords, '?claim=mine')).items.map((i) => i.caseId)).toContain(c.id);

        // the other holder: no claim, no action, no release; the page shows them nothing to do
        expect((await claim(as.damotRecords2, c)).statusCode).toBe(409);
        expect((await act(as.damotRecords2, c.id, 'forward')).statusCode).toBe(409);
        expect((await claim(as.damotRecords2, c, true)).statusCode).toBe(409);
        expect((await get(as.damotRecords2, c.id)).actions).toEqual([]);
        // another role may not claim it; a head of the office may give it back (someone away)
        expect((await claim(as.damotHead, c)).statusCode).toBe(403);
        expect((await claim(as.damotHead, c, true)).statusCode).toBe(200);

        // taken on again and acted on by the other holder
        expect((await claim(as.damotRecords2, c)).statusCode).toBe(200);
        const forwarded = await act(as.damotRecords2, c.id, 'forward');
        expect(forwarded.statusCode, forwarded.body).toBe(200);
        // a closed step is no longer claimed
        const closed = await api.call(
            'POST',
            `/api/v1/cases/${c.id}/tasks/${c.tasks.find((t) => t.status === 'open')?.id ?? ''}/claim`,
            as.damotRecords2
        );
        expect(closed.statusCode).toBe(409);

        const audit = await api.owner.query<{ action: string }>(
            `select action from kernel.audit_log where table_name = 'workflow.case_tasks' and row_id = $1::uuid
              order by at`,
            [c.tasks.find((t) => t.status === 'open')?.id]
        );
        expect(audit.rows.filter((r) => r.action === 'update').length).toBeGreaterThanOrEqual(4);
    });

    it('is refused to whom separation of duties keeps off the step; the inbox says so', async () => {
        const c = await submitted();
        expect((await claim(as.damotRecords, c)).statusCode).toBe(200);
        expect((await act(as.damotRecords, c.id, 'forward')).statusCode).toBe(200);
        const approval = await get(as.damotRecords, c.id);
        expect(approval.state).toBe('approval');
        // the reviewer sees the approval, marked, and may not take it on
        expect((await inbox(as.damotRecords)).items.find((i) => i.caseId === c.id)?.mayAct).toBe(false);
        expect((await claim(as.damotRecords, approval)).statusCode).toBe(403);
        expect((await inbox(as.damotRecords2)).items.find((i) => i.caseId === c.id)?.mayAct).toBe(true);
        expect((await claim(as.damotRecords2, approval)).statusCode).toBe(200);
    });
});

describe('a comment', () => {
    it('goes on the timeline with its mentions, audited; the worker tells each person once', async () => {
        const c = await submitted();
        const [zoneHead, damotHead, me] = await Promise.all([
            api.userId(SUB.zoneHead),
            api.userId(SUB.damotHead),
            api.userId(SUB.damotRecords)
        ]);
        // who may be mentioned: the people working on the case, here and above; never a sibling office's
        const people = (await api.call('GET', `/api/v1/cases/${c.id}/people?q=Head`, as.damotRecords)).json<{
            items: { id: string; name: string }[];
        }>().items;
        expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([zoneHead, damotHead]));
        expect(people.map((p) => p.name)).not.toContain('Boditi Head (demo)');

        const outside = await api.call('POST', `/api/v1/cases/${c.id}/comments`, as.damotRecords, {
            text: 'Boditi, please look',
            mentions: [await api.userId(SUB.boditiHead)]
        });
        expect(outside.statusCode, outside.body).toBe(422);

        const res = await api.call('POST', `/api/v1/cases/${c.id}/comments`, as.damotRecords, {
            text: '@Zone Head (demo) the applicant brings the libre tomorrow',
            mentions: [zoneHead, damotHead, me]
        });
        expect(res.statusCode, res.body).toBe(201);
        const comment = res.json<CaseOut>().events.at(-1);
        expect(comment).toMatchObject({
            kind: 'comment',
            actorName: 'Damot Gale Records Officer (demo)',
            comment: '@Zone Head (demo) the applicant brings the libre tomorrow',
            visibility: 'internal'
        });
        expect(comment?.mentions.map((m) => m.id).sort()).toEqual([zoneHead, damotHead, me].sort());
        const audit = await api.owner.query(
            `select 1 from kernel.audit_log where table_name = 'workflow.case_events' and row_id = $1::uuid
               and action = 'insert'`,
            [comment?.id]
        );
        expect(audit.rowCount).toBe(1);

        // the event the worker takes: the author is not told of their own mention
        const event = await api.owner.query<{ payload: { mentions: string[] } }>(
            `select payload from kernel.outbox_events where type = 'case.commented.v1' and payload ->> 'eventId' = $1`,
            [comment?.id]
        );
        expect(event.rows[0]?.payload.mentions.sort()).toEqual([zoneHead, damotHead].sort());
        const input = { caseId: c.id, eventId: comment?.id ?? '', mentions: event.rows[0]?.payload.mentions ?? [] };
        expect(await tellMentioned(system, input)).toBe(2);
        expect(await tellMentioned(system, input)).toBe(0);
        const told = (await notes(as.zoneHead)).filter((n) => n.link?.eventId === comment?.id);
        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({ key: 'workflow.notify.mentioned', link: { caseId: c.id } });
        expect(told[0]?.text.en).toBe(
            `Case ${c.number}: Damot Gale Records Officer (demo) mentioned you in a comment.`
        );
        expect((await notes(as.damotHead)).filter((n) => n.link?.eventId === comment?.id)).toHaveLength(1);
        expect((await notes(as.damotRecords)).filter((n) => n.link?.eventId === comment?.id)).toEqual([]);
    });

    it('needs case:comment, and reaches no other office', async () => {
        const c = await submitted();
        const auditor = await api.call('POST', `/api/v1/cases/${c.id}/comments`, as.zoneAuditor, { text: 'Seen' });
        expect(auditor.statusCode).toBe(403);
        expect((await get(as.zoneAuditor, c.id)).canComment).toBe(false);
        const sibling = await api.call('POST', `/api/v1/cases/${c.id}/comments`, as.boditiRecords, { text: 'Hi' });
        expect(sibling.statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/cases/${c.id}/people`, as.boditiRecords)).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/cases/${c.id}`, as.boditiRecords)).statusCode).toBe(404);
        const empty = await api.call('POST', `/api/v1/cases/${c.id}/comments`, as.damotRecords, { text: '  ' });
        expect(empty.statusCode).toBe(422);
    });
});
