/**
 * A comment's mentions (task 0.20b), in the worker's system context: each person a comment names is told in the
 * application (no SMS: a mention is not urgent). Only people who still work on the case (an active role that reads
 * cases, in its handling office or one above it) are told, and nobody twice, whatever the order or how often the event
 * is handed over: deliveries of one comment wait for each other (an advisory lock), then skip whom it already told.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { notify } from '@itrms/kernel/notifications';
import { users } from '@itrms/kernel/tables';

import { caseEvents, cases } from '../workflow.table';

/** Tells the people a comment mentions; the number told (0 when the comment or the case is gone, or all were told). */
export async function tellMentioned(
    system: SystemDatabase,
    input: { caseId: string; eventId: string; mentions: readonly string[] },
    /** the roles that read cases (`CasesService.caseReaders`) */
    readers: readonly string[]
): Promise<number> {
    return system.systemContext('workflow.comment_mentions', async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`workflow.comment:${input.eventId}`}))`);
        const [comment] = await tx
            .select({
                regionId: cases.regionId,
                unitId: cases.handlingUnitId,
                number: cases.number,
                author: users.displayName
            })
            .from(caseEvents)
            .innerJoin(cases, eq(cases.id, caseEvents.caseId))
            .innerJoin(users, eq(users.id, caseEvents.actorUserId))
            .where(
                and(
                    eq(caseEvents.id, input.eventId),
                    eq(caseEvents.caseId, input.caseId),
                    eq(caseEvents.kind, 'comment')
                )
            );
        if (!comment || input.mentions.length === 0) return 0;
        const ids = `{${input.mentions.join(',')}}`;
        const link = { caseId: input.caseId, eventId: input.eventId };
        // still working on the case, and not told of this comment yet
        const result = await tx.execute<{ id: string }>(
            sql`select distinct us.id from kernel.users us
                  join kernel.role_assignments ra on ra.user_id = us.id
                  join kernel.org_units u on u.id = ra.unit_id
                  join workflow.cases c on c.id = ${input.caseId}::uuid and u.path @> c.org_path
                 where us.id = any(${ids}::uuid[]) and us.active
                   and ra.role_key = any(${`{${readers.join(',')}}`}::text[])
                   and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())
                   and not exists (select 1 from kernel.org_units a where a.path @> u.path and not a.active)
                   and not exists (select 1 from kernel.notifications n
                                    where n.user_id = us.id and n.message_key = 'workflow.notify.mentioned'
                                      and n.link ->> 'eventId' = ${input.eventId})`
        );
        await notify(
            tx,
            result.rows.map((r) => ({
                userId: r.id,
                regionId: comment.regionId,
                unitId: comment.unitId,
                messageKey: 'workflow.notify.mentioned',
                params: { number: String(comment.number), author: comment.author },
                link
            }))
        );
        return result.rows.length;
    });
}
