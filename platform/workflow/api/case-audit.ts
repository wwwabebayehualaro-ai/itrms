/**
 * A case's audit trail (task 0.25e, demo-plan.md §3 step 12): who did what to it and when, from the audit log. A row belongs to
 * the case when it is the case's own row, or a row that names the case (\`caseId\`: its tasks, events, request, payment order,
 * documents, licence). The reader's scope decides what they see: the audit log is a class-T table, its rows on the path of the
 * office that acted. Of a change, only the names of the fields changed are given, never their values: a value may be a
 * person's (SEC-PD-2), and the audit log keeps it for those who investigate, not for a screen.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { auditLog, recordEvent, type Tx } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { users } from '@itrms/kernel/tables';

import type { CaseAudit } from '../contracts';
import { cases } from './workflow.table';

/** The most lines a trail gives, the newest: a case has a few dozen; a longer trail says it was cut (not paged). */
export const CASE_AUDIT_LIMIT = 500;

/** The case a row names; the migration indexes the same expression (0059_case_audit_index.sql). */
const caseNamed = sql`(${auditLog.diff}->>'caseId')`;

/** What every row has, or what places it: not a change a person made. */
const BOOKKEEPING = new Set([
    'id',
    'regionId',
    'orgPath',
    'caseId',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'rowVersion'
]);

/** The names of the fields a change touched: an insert's, an update's changed ones, a delete's, an event's. */
export function fieldsOf(action: string, diff: unknown): string[] {
    const d = (diff && typeof diff === 'object' ? diff : {}) as Record<string, unknown>;
    const part = action === 'event' ? d : action === 'delete' ? d.before : d.after;
    if (!part || typeof part !== 'object' || Array.isArray(part)) return [];
    return Object.keys(part)
        .filter((k) => !BOOKKEEPING.has(k))
        .sort();
}

/**
 * The trail of a case the reader can see (a case outside their scope: 404), newest first. Reading it is on record: the trail
 * shows it the next time.
 */
export async function caseAuditTrail(tx: Tx, caseId: string): Promise<CaseAudit> {
    const [found] = await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId));
    if (!found) throw new NotFoundError();
    await recordEvent(tx, { type: 'case.audit_read', table: cases, rowId: caseId });
    const rows = await tx
        .select({
            at: auditLog.at,
            action: auditLog.action,
            table: auditLog.tableName,
            event: auditLog.eventType,
            actorId: auditLog.actorId,
            diff: auditLog.diff
        })
        .from(auditLog)
        .where(
            or(and(eq(auditLog.tableName, 'workflow.cases'), eq(auditLog.rowId, caseId)), sql`${caseNamed} = ${caseId}`)
        )
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(CASE_AUDIT_LIMIT + 1);
    const truncated = rows.length > CASE_AUDIT_LIMIT;
    if (truncated) rows.length = CASE_AUDIT_LIMIT;
    const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))];
    const names = new Map(
        ids.length === 0
            ? []
            : (
                  await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids))
              ).map((u) => [u.id, u.name])
    );
    return {
        truncated,
        items: rows.map((r) => ({
            at: r.at.toISOString(),
            action: r.action,
            table: r.table,
            event: r.event,
            actor: r.actorId ? { id: r.actorId, name: names.get(r.actorId) ?? '' } : null,
            fields: fieldsOf(r.action, r.diff)
        }))
    };
}
