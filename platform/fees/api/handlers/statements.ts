/**
 * Reading a statement and matching references (task 0.22c, ADR-0043), in the worker: never in a request. Reading a file
 * is one transaction, each line's match another, so one line that can't settle (nobody holds the next step's role) stops
 * neither the others nor the file, and a retried job carries on from where it was. A statement verifies only references
 * of its own office's subtree, on an exact match (statement-match.ts); the rest waits for a person, with the reason.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { actFor, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import { AppError } from '@itrms/kernel/errors';

import { STATEMENT_LAYOUT } from '../../contracts';
import type { FeeCasePort } from '../case-port';
import { settleByReference } from '../external-settlement';
import { addisDayOf, externalReferenceKey, fiscalYearOfDay } from '../external-refs';
import { externalPaymentRefs, externalStatementLines, externalStatements, paymentOrders } from '../fees.table';
import { parseStatement } from '../statement-layouts';
import { judgeLine } from '../statement-match';

export interface StatementDeps {
    cases?: FeeCasePort;
}

type LineRow = typeof externalStatementLines.$inferSelect;

/**
 * Lines still able to verify a reference: a new entry may make what held a line right. Not one whose reference was
 * revoked: re-entering it would undo the revocation, so a person decides.
 */
const OPEN_LINES = ['unmatched', 'amount_mismatch', 'held'] as const;
const isOpen = (line: Pick<LineRow, 'state' | 'reason'>) =>
    OPEN_LINES.includes(line.state as (typeof OPEN_LINES)[number]) && line.reason !== 'reference_revoked';

const actAs = (tx: Tx, row: { regionId: string; handlingUnitId: string; orgPath: string }) =>
    actFor(tx, { regionId: row.regionId, unitId: row.handlingUnitId, scopePath: row.orgPath });

/** Reads the file into lines, once: a file that isn't the layout fails on record, for a person to see. */
async function readLines(system: SystemDatabase, statementId: string): Promise<boolean> {
    return system.systemContext('fees.statement_read', async (tx) => {
        const [statement] = await tx
            .select()
            .from(externalStatements)
            .where(eq(externalStatements.id, statementId))
            .for('update');
        if (!statement) return false;
        if (statement.state === 'matching') return true;
        if (statement.state !== 'received') return false;
        actAs(tx, statement);
        const parsed = parseStatement(STATEMENT_LAYOUT, statement.content);
        if (!parsed.ok) {
            await updateAudited(tx, externalStatements, statement.id, statement.rowVersion, {
                state: 'failed',
                failure: parsed.failure
            });
            return false;
        }
        const keyOf = (norm: string, year: number) => `${norm}|${year}`;
        const seen = new Set<string>();
        for (const line of parsed.lines) {
            const norm = line.reference === null ? null : externalReferenceKey(line.reference);
            const year = line.paidOn === null ? null : fiscalYearOfDay(line.paidOn);
            let state: LineRow['state'] = 'unmatched';
            let reason: string | null = null;
            if (line.invalid || !norm || year === null) {
                state = 'invalid';
                reason = line.invalid ?? 'reference';
            } else if (seen.has(keyOf(norm, year))) {
                state = 'duplicate';
                reason = 'in_this_file';
            } else {
                const [earlier] = await tx
                    .select({ id: externalStatementLines.id })
                    .from(externalStatementLines)
                    .where(
                        and(
                            eq(externalStatementLines.regionId, statement.regionId),
                            eq(externalStatementLines.issuer, statement.issuer),
                            eq(externalStatementLines.referenceNorm, norm),
                            eq(externalStatementLines.fiscalYear, year),
                            sql`${externalStatementLines.state} not in ('duplicate', 'invalid')`
                        )
                    )
                    .limit(1);
                if (earlier) {
                    state = 'duplicate';
                    reason = 'in_another_statement';
                } else seen.add(keyOf(norm, year));
            }
            await insertAudited(tx, externalStatementLines, {
                regionId: statement.regionId,
                handlingUnitId: statement.handlingUnitId,
                statementId: statement.id,
                lineNo: line.lineNo,
                issuer: statement.issuer,
                reference: line.reference,
                referenceNorm: state === 'invalid' ? null : norm,
                fiscalYear: state === 'invalid' ? null : year,
                paidOn: state === 'invalid' ? null : line.paidOn,
                amountSantim: state === 'invalid' ? null : line.amountSantim,
                state,
                reason
            });
        }
        await updateAudited(tx, externalStatements, statement.id, statement.rowVersion, { state: 'matching' });
        return true;
    });
}

/**
 * Tries one line against the live reference of its key in its statement's subtree. Locks in the one order: the case, the
 * order, the reference, then the line. Exact, it settles the order; else the line says why it waits.
 */
export async function matchLine(system: SystemDatabase, deps: StatementDeps, lineId: string): Promise<void> {
    const findRef = async (tx: Tx, line: LineRow) => {
        const [ref] = await tx
            .select()
            .from(externalPaymentRefs)
            .where(
                and(
                    eq(externalPaymentRefs.regionId, line.regionId),
                    eq(externalPaymentRefs.issuer, line.issuer),
                    eq(externalPaymentRefs.referenceNorm, line.referenceNorm ?? ''),
                    eq(externalPaymentRefs.fiscalYear, line.fiscalYear ?? 0),
                    eq(externalPaymentRefs.state, 'pending_verification'),
                    sql`${externalPaymentRefs.orgPath} <@ ${line.orgPath}::ltree`
                )
            );
        return ref;
    };
    try {
        await system.systemContext('fees.statement_match', async (tx) => {
            const [seen] = await tx.select().from(externalStatementLines).where(eq(externalStatementLines.id, lineId));
            if (!seen || !isOpen(seen)) return;
            const seenRef = await findRef(tx, seen);
            if (!seenRef) return;
            const kase = await deps.cases?.lock(tx, seenRef.caseId);
            if (kase?.closed) return;
            const [order] = await tx
                .select()
                .from(paymentOrders)
                .where(eq(paymentOrders.id, seenRef.orderId))
                .for('update');
            const [ref] = await tx
                .select()
                .from(externalPaymentRefs)
                .where(eq(externalPaymentRefs.id, seenRef.id))
                .for('update');
            const [line] = await tx
                .select()
                .from(externalStatementLines)
                .where(eq(externalStatementLines.id, lineId))
                .for('update');
            const [statement] = await tx
                .select({ importedBy: externalStatements.importedBy })
                .from(externalStatements)
                .where(eq(externalStatements.id, seen.statementId));
            if (!order || !ref || !line || !statement) return;
            if (ref.state !== 'pending_verification' || order.state !== 'open') return;
            if (!isOpen(line)) return;
            if (line.amountSantim === null || line.paidOn === null) return;
            actAs(tx, ref);
            const verdict = judgeLine({
                line: { amountSantim: line.amountSantim, paidOn: line.paidOn },
                ref: { amountSantim: ref.amountSantim, paidOn: ref.paidOn, enteredBy: ref.enteredBy },
                orderDay: addisDayOf(order.createdAt),
                importedBy: statement.importedBy
            });
            await updateAudited(tx, externalStatementLines, line.id, line.rowVersion, {
                state: verdict.state,
                reason: verdict.state === 'held' ? verdict.reason : null,
                refId: ref.id
            });
            if (verdict.state === 'matched')
                await settleByReference(tx, {}, deps.cases, { order, ref, via: 'statement', language: 'am' });
        });
    } catch (error) {
        // a refusal (nobody holds the next step's role, an effect's rule): the money waits for a person, the file goes on.
        // Anything else may pass: the job is retried, and the lines done stay done
        if (!(error instanceof AppError)) throw error;
        await system.systemContext('fees.statement_match', async (tx) => {
            const [line] = await tx
                .select()
                .from(externalStatementLines)
                .where(eq(externalStatementLines.id, lineId))
                .for('update');
            if (!line) return;
            actAs(tx, line);
            await updateAudited(tx, externalStatementLines, line.id, line.rowVersion, {
                state: 'held',
                reason: 'cannot_settle'
            });
        });
    }
}

/** Reads a statement and matches its lines: retried, it carries on where it was. */
export async function processStatement(
    system: SystemDatabase,
    deps: StatementDeps,
    statementId: string
): Promise<void> {
    if (!(await readLines(system, statementId))) return;
    const lines = await system.systemContext('fees.statement_lines', (tx) =>
        tx
            .select({ id: externalStatementLines.id })
            .from(externalStatementLines)
            .where(
                and(
                    eq(externalStatementLines.statementId, statementId),
                    inArray(externalStatementLines.state, [...OPEN_LINES])
                )
            )
            .orderBy(asc(externalStatementLines.lineNo))
    );
    for (const line of lines) await matchLine(system, deps, line.id);
    await system.systemContext('fees.statement_done', async (tx) => {
        const [statement] = await tx
            .select()
            .from(externalStatements)
            .where(eq(externalStatements.id, statementId))
            .for('update');
        if (statement?.state !== 'matching') return;
        actAs(tx, statement);
        await updateAudited(tx, externalStatements, statement.id, statement.rowVersion, { state: 'processed' });
    });
}

/** A reference just entered: a statement imported before it may already hold its line. */
export async function matchEntered(system: SystemDatabase, deps: StatementDeps, refId: string): Promise<void> {
    const line = await system.systemContext('fees.reference_match', async (tx) => {
        const [ref] = await tx.select().from(externalPaymentRefs).where(eq(externalPaymentRefs.id, refId));
        if (ref?.state !== 'pending_verification') return undefined;
        const [found] = await tx
            .select({ id: externalStatementLines.id })
            .from(externalStatementLines)
            .where(
                and(
                    eq(externalStatementLines.regionId, ref.regionId),
                    eq(externalStatementLines.issuer, ref.issuer),
                    eq(externalStatementLines.referenceNorm, ref.referenceNorm),
                    eq(externalStatementLines.fiscalYear, ref.fiscalYear),
                    inArray(externalStatementLines.state, [...OPEN_LINES]),
                    sql`${externalStatementLines.orgPath} @> ${ref.orgPath}::ltree`
                )
            );
        return found;
    });
    if (line) await matchLine(system, deps, line.id);
}
