/**
 * The SLA timers (architecture.md §8, task 0.20a), in the worker's system context. A step's or a wait's due event becomes
 * available at its due time (the outbox's `available_at`); a 15-minute sweep catches any the relay lost.
 *
 * - An overdue step is marked, and its office's heads are told; the office above is told too (escalation adds the
 *   supervisor's visibility, never changes who may decide).
 * - A wait past its SLA leaves by its timeout, taken by `system:timer`; a wait without a timeout transition stops being
 *   timed (its due time is cleared).
 *
 * Each runs once whatever the order: a step already closed or marked, a case already moved on, is left alone.
 */
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { actFor, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { AppError } from '@itrms/kernel/errors';
import { notify, type Notice, type SmsSender } from '@itrms/kernel/notifications';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { orgUnits } from '@itrms/kernel/tables';

import { WORKFLOW_EVENTS } from '../../contracts';
import type { CasesService } from '../cases.service';
import { SYSTEM_TIMER } from '../engine/rules';
import { cases, caseTasks } from '../workflow.table';

export interface SlaDeps {
    cases: CasesService;
    sms: SmsSender;
    now?: () => Date;
}

/** The sweep's batch: what it finds overdue in one run (the next run takes the rest). */
export const SLA_BATCH = 200;

/** Who heads a unit (holds `unit_head` there), active people in an active office. */
async function heads(tx: Tx, unitId: string): Promise<string[]> {
    const result = await tx.execute<{ id: string }>(
        sql`select ra.user_id as id from kernel.role_assignments ra
              join kernel.users u on u.id = ra.user_id
              join kernel.org_units ou on ou.id = ra.unit_id
             where ra.unit_id = ${unitId}::uuid and ra.role_key = 'unit_head' and ra.valid_from <= now()
               and (ra.valid_to is null or ra.valid_to > now()) and u.active
               and not exists (select 1 from kernel.org_units a where a.path @> ou.path and not a.active)`
    );
    return result.rows.map((r) => r.id);
}

/** Marks a step overdue and tells its office's heads and those of the office above. False when there is nothing to do. */
export async function overdueTask(system: SystemDatabase, deps: SlaDeps, taskId: string): Promise<boolean> {
    const now = deps.now?.() ?? new Date();
    return system.systemContext('workflow.sla_overdue', async (tx) => {
        const [task] = await tx.select().from(caseTasks).where(eq(caseTasks.id, taskId)).for('update');
        if (!task || task.status !== 'open' || task.overdueAt || !task.dueAt || task.dueAt > now) return false;
        const [kase] = await tx.select({ number: cases.number }).from(cases).where(eq(cases.id, task.caseId));
        actFor(tx, { regionId: task.regionId, unitId: task.unitId, scopePath: task.orgPath });
        await updateAudited(tx, caseTasks, task.id, task.rowVersion, { overdueAt: now });
        const [unit] = await tx
            .select({ parentId: orgUnits.parentId })
            .from(orgUnits)
            .where(eq(orgUnits.id, task.unitId));
        const params = { number: String(kase?.number ?? ''), state: task.stateKey };
        const link = { caseId: task.caseId };
        const own = await heads(tx, task.unitId);
        const above = unit?.parentId ? (await heads(tx, unit.parentId)).filter((u) => !own.includes(u)) : [];
        const notices: Notice[] = [
            ...own.map((userId) => ({
                userId,
                regionId: task.regionId,
                unitId: task.unitId,
                messageKey: 'workflow.notify.overdue',
                params,
                link
            })),
            ...above.map((userId) => ({
                userId,
                regionId: task.regionId,
                unitId: task.unitId,
                messageKey: 'workflow.notify.escalated',
                params,
                link
            }))
        ];
        await notify(tx, notices);
        for (const n of notices)
            await deps.sms.send({ userId: n.userId, text: `Case ${params.number}: step ${params.state} is overdue.` });
        return true;
    });
}

/** Delivers a wait's timeout once it is due. False when the case has moved on (or the wait is not timed). */
export async function waitTimeout(system: SystemDatabase, deps: SlaDeps, caseId: string): Promise<boolean> {
    const now = deps.now?.() ?? new Date();
    return system.systemContext('workflow.sla_timeout', async (tx) => {
        const [kase] = await tx.select().from(cases).where(eq(cases.id, caseId)).for('update');
        if (!kase || kase.closedAt || !kase.dueAt || kase.dueAt > now) return false;
        try {
            await deps.cases.deliver(tx, caseId, 'timeout', { kind: 'system', id: SYSTEM_TIMER });
            return true;
        } catch (error) {
            // a wait its workflow does not time out (or no longer in a wait): stop timing it
            if (!(error instanceof AppError)) throw error;
            const [current] = await tx.select().from(cases).where(eq(cases.id, caseId));
            if (current) await updateAudited(tx, cases, current.id, current.rowVersion, { dueAt: null });
            return false;
        }
    });
}

/** Finds what is due and not yet handled (the timers the relay lost), and handles it. Returns how many it handled. */
export async function slaSweep(system: SystemDatabase, deps: SlaDeps): Promise<number> {
    const now = deps.now?.() ?? new Date();
    const due = await system.systemContext(
        'workflow.sla_sweep',
        async (tx) => ({
            tasks: await tx
                .select({ id: caseTasks.id })
                .from(caseTasks)
                .where(and(eq(caseTasks.status, 'open'), isNull(caseTasks.overdueAt), lte(caseTasks.dueAt, now)))
                .limit(SLA_BATCH),
            cases: await tx
                .select({ id: cases.id })
                .from(cases)
                .where(and(isNull(cases.closedAt), isNotNull(cases.dueAt), lte(cases.dueAt, now)))
                .limit(SLA_BATCH)
        }),
        { recurring: true }
    );
    let handled = 0;
    for (const t of due.tasks) if (await overdueTask(system, deps, t.id)) handled++;
    for (const c of due.cases) if (await waitTimeout(system, deps, c.id)) handled++;
    return handled;
}

/** The SLA timers' handlers: an event that became available at its due time. */
export function workflowHandlers(system: SystemDatabase, deps: SlaDeps): Record<string, OutboxHandler> {
    return {
        'case-task.due.v1': async (job) => {
            await overdueTask(system, deps, WORKFLOW_EVENTS['case-task.due.v1'].parse(job.payload).taskId);
        },
        'case.wait-due.v1': async (job) => {
            await waitTimeout(system, deps, WORKFLOW_EVENTS['case.wait-due.v1'].parse(job.payload).caseId);
        }
    };
}
