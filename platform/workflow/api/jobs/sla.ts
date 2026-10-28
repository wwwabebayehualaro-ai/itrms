/**
 * The SLA timers (architecture.md §8, task 0.20a), in the worker's system context. A step's or a wait's due event becomes
 * available at its due time (the outbox's `available_at`); a 15-minute sweep catches any the relay lost.
 *
 * - An overdue step is marked, and its office's heads are told; the office above is told too (escalation adds the
 *   supervisor's visibility, never changes who may decide). The SMS go out after the commit, in each person's language.
 * - A wait past its SLA leaves by its timeout, taken by `system:timer`; a wait without a timeout transition stops being
 *   timed (its due time is cleared). A timeout that fails half way (an effect, the next step's assignment) undoes
 *   everything and is tried again.
 * - "Due" is the database's clock (the relay's), not the worker's.
 *
 * Each runs once whatever the order: a step already closed or marked, a case already moved on, is left alone.
 */
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { actFor, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { notify, type Notice, type SmsSender } from '@itrms/kernel/notifications';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { orgUnits, users } from '@itrms/kernel/tables';
import { workflowDefinitionSchema } from '@itrms/schemas';

import { WORKFLOW_EVENTS } from '../../contracts';
import am from '../../messages/am.json';
import en from '../../messages/en.json';
import type { CasesService } from '../cases.service';
import { SYSTEM_TIMER } from '../engine/rules';
import { cases, caseTasks, workflowDefinitionVersions } from '../workflow.table';

export interface SlaDeps {
    cases: CasesService;
    sms: SmsSender;
    /** an item the sweep could not handle (it goes on with the others) */
    onError?: (error: unknown, what: string) => void;
}

/** The sweep's batch: what it finds overdue in one run (the next run takes the rest). */
export const SLA_BATCH = 200;

const CATALOGUES: Record<string, Record<string, string>> = { am, en };

/** A notice's text in a language (the SMS's): its message with its values, the per-language ones first. */
function textOf(notice: Notice, language: string): string {
    let text =
        CATALOGUES[language]?.[notice.messageKey] ?? am[notice.messageKey as keyof typeof am] ?? notice.messageKey;
    for (const [k, v] of Object.entries(notice.params))
        if (!k.includes(':')) text = text.replaceAll(`{${k}}`, notice.params[`${k}:${language}`] ?? v);
    return text;
}

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
    const messages = await system.systemContext('workflow.sla_overdue', async (tx) => {
        const [task] = await tx
            .select()
            .from(caseTasks)
            .where(
                and(
                    eq(caseTasks.id, taskId),
                    eq(caseTasks.status, 'open'),
                    isNull(caseTasks.overdueAt),
                    sql`${caseTasks.dueAt} <= now()`
                )
            )
            .for('update');
        if (!task) return null;
        const [kase] = await tx
            .select({ number: cases.number, definition: workflowDefinitionVersions.definition })
            .from(cases)
            .innerJoin(workflowDefinitionVersions, eq(workflowDefinitionVersions.id, cases.definitionVersionId))
            .where(eq(cases.id, task.caseId));
        actFor(tx, { regionId: task.regionId, unitId: task.unitId, scopePath: task.orgPath });
        await updateAudited(tx, caseTasks, task.id, task.rowVersion, { overdueAt: sql`now()` as unknown as Date });
        // the step's name in each language, else its key
        const parsed = workflowDefinitionSchema.safeParse(kase?.definition);
        const label = parsed.success ? parsed.data.states.find((s) => s.key === task.stateKey)?.label : undefined;
        const params: Record<string, string> = {
            number: String(kase?.number ?? ''),
            state: task.stateKey,
            ...Object.fromEntries(Object.entries(label ?? {}).map(([language, text]) => [`state:${language}`, text]))
        };
        const link = { caseId: task.caseId };
        const [unit] = await tx
            .select({ parentId: orgUnits.parentId })
            .from(orgUnits)
            .where(eq(orgUnits.id, task.unitId));
        const own = await heads(tx, task.unitId);
        const above = unit?.parentId ? (await heads(tx, unit.parentId)).filter((u) => !own.includes(u)) : [];
        const notice = (userId: string, messageKey: string): Notice => ({
            userId,
            regionId: task.regionId,
            unitId: task.unitId,
            messageKey,
            params,
            link
        });
        const notices = [
            ...own.map((u) => notice(u, 'workflow.notify.overdue')),
            ...above.map((u) => notice(u, 'workflow.notify.escalated'))
        ];
        await notify(tx, notices);
        // each person's language for the SMS (Amharic unless they chose another)
        const languages = new Map(
            (
                await tx
                    .select({ id: users.id, language: sql<string | null>`${users.preferences} ->> 'language'` })
                    .from(users)
                    .where(sql`${users.id} = any(${`{${notices.map((n) => n.userId).join(',')}}`}::uuid[])`)
            ).map((u) => [u.id, u.language ?? 'am'])
        );
        return notices.map((n) => ({ userId: n.userId, text: textOf(n, languages.get(n.userId) ?? 'am') }));
    });
    if (!messages) return false;
    // after the commit: a failed transaction sends nothing, a retry never sends twice
    for (const m of messages) await deps.sms.send(m);
    return true;
}

/** Delivers a wait's timeout once it is due. False when the case has moved on (or the wait is not timed). */
export async function waitTimeout(system: SystemDatabase, deps: SlaDeps, caseId: string): Promise<boolean> {
    return system.systemContext('workflow.sla_timeout', async (tx) => {
        const [kase] = await tx
            .select({ id: cases.id })
            .from(cases)
            .where(and(eq(cases.id, caseId), isNull(cases.closedAt), sql`${cases.dueAt} <= now()`))
            .for('update');
        if (!kase) return false;
        const moved = await deps.cases.deliver(tx, caseId, 'timeout', { kind: 'system', id: SYSTEM_TIMER }, 'am', {
            quiet: true
        });
        if (moved) return true;
        // a wait its workflow does not time out (nothing was written): stop timing it
        const [current] = await tx.select().from(cases).where(eq(cases.id, caseId));
        if (current) await updateAudited(tx, cases, current.id, current.rowVersion, { dueAt: null });
        return false;
    });
}

/** Finds what is due and not yet handled (the timers the relay lost), oldest first, and handles it one by one. */
export async function slaSweep(system: SystemDatabase, deps: SlaDeps): Promise<number> {
    const due = await system.systemContext(
        'workflow.sla_sweep',
        async (tx) => ({
            tasks: await tx
                .select({ id: caseTasks.id })
                .from(caseTasks)
                .where(and(eq(caseTasks.status, 'open'), isNull(caseTasks.overdueAt), sql`${caseTasks.dueAt} <= now()`))
                .orderBy(asc(caseTasks.dueAt))
                .limit(SLA_BATCH),
            cases: await tx
                .select({ id: cases.id })
                .from(cases)
                .where(and(isNull(cases.closedAt), isNotNull(cases.dueAt), sql`${cases.dueAt} <= now()`))
                .orderBy(asc(cases.dueAt))
                .limit(SLA_BATCH)
        }),
        { recurring: true }
    );
    let handled = 0;
    // one that fails (a broken effect, a step nobody may take) never stops the others; it is tried again next time
    const each = async (what: string, run: () => Promise<boolean>) => {
        try {
            if (await run()) handled++;
        } catch (error) {
            deps.onError?.(error, what);
        }
    };
    for (const t of due.tasks) await each(`task ${t.id}`, () => overdueTask(system, deps, t.id));
    for (const c of due.cases) await each(`case ${c.id}`, () => waitTimeout(system, deps, c.id));
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
