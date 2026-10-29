/**
 * Cases and their transitions (architecture.md §8, task 0.19b). A case runs on the workflow version it started with and
 * the configuration frozen at its start; its state changes only through a transition, and a transition runs entirely in
 * the caller's transaction: the engine's decision (engine/rules.ts), the step form's answers (validated by the forms
 * slice), the effects (the kernel's registry), the task closed and the next one opened, the timeline, the audit rows and
 * the outbox event. A failing effect rolls everything back.
 *
 * - A person acts on the open task of their active unit with the step's role; the start is acted on by whoever started
 *   the case. Events and timeouts out of a wait state are taken by system actors (`deliver`, from the worker's system
 *   context); 0.20 wires the SLA timers to it.
 * - The next task goes to the unit the step's rule names. When separation of duties leaves nobody there to take it, it
 *   goes up the tree to the first unit that has someone, recorded on the case; with nobody anywhere the transition is
 *   refused, never relaxed.
 * - A task in a unit outside the actor's scope (the zone's approval of a town's case) is opened through the reviewed
 *   `workflow.open_task`, which checks the case and the unit again in SQL.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
    actFor,
    contentHash,
    insertAudited,
    newId,
    recordEvent,
    updateAudited,
    type DbContext,
    type Tx
} from '@itrms/kernel/db';
import { EffectRegistry } from '@itrms/kernel/effects';
import { rolePermissions, SHELL, type Shell } from '@itrms/kernel/iam';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs, withinScope, type UnitRef as UnitLabel } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { orgUnits, users } from '@itrms/kernel/tables';
import { contractInput } from '@itrms/form-engine/core';
import { FormsService, RegistryLookups, SubmissionsService, submissions } from '@itrms/forms/api';
import {
    effectKeyOf,
    parseStepForm,
    workflowDefinitionSchema,
    workflowSlaSchema,
    workflowUnitRuleSchema,
    type WorkflowDefinition,
    type WorkflowState,
    type WorkflowTransition,
    type EffectContract
} from '@itrms/schemas';
import { z } from 'zod';

import {
    DUE_SOON_HOURS,
    type CaseOut,
    type CommentCreate,
    type Inbox,
    type InboxItem,
    type InboxQuery,
    type PersonRef,
    type SlaState,
    type Transition
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import {
    actionsFor,
    assigneeUnit,
    decideAction,
    decideEvent,
    excludedBySeparation,
    routeStep,
    stateOf,
    type Refusal,
    type StepHistory,
    type SystemActor,
    type UnitRef
} from './engine/rules';
import { dueAt } from './sla';
import { caseEvents, cases, caseTasks, workflowDefinitions, workflowDefinitionVersions } from './workflow.table';

type CaseRow = typeof cases.$inferSelect;
type TaskRow = typeof caseTasks.$inferSelect;

/** Who acts: the signed-in person, their active unit, the roles they hold there and what those give. */
export interface CaseActor {
    userId: string;
    unitId: string;
    roles: readonly string[];
    permissions?: ReadonlySet<string>;
}

/** What only this service refuses (the engine's refusals are `Refusal`): a step someone else took on, or not taken on. */
type ClaimRefusal = 'claimed' | 'not-claimed' | 'task-closed';

/**
 * The configuration a service freezes on a case (task 0.21b resolves it): the engine reads `approval_unit` and a step's
 * SLA where the service set one (`sla.<state>`), before the workflow's own.
 */
export const caseConfigSchema = z
    .object({
        approval_unit: workflowUnitRuleSchema.optional(),
        sla: z.record(z.string(), workflowSlaSchema).optional()
    })
    .catchall(z.unknown())
    .refine((c) => c.approval_unit !== '${approval_unit}', 'approval_unit names a unit rule');
export type CaseConfig = z.infer<typeof caseConfigSchema>;

/** A state's SLA on a case: the one its service froze, else the workflow's. */
export function slaOfState(config: unknown, state: WorkflowState) {
    const parsed = caseConfigSchema.safeParse(config);
    return (parsed.success ? parsed.data.sla?.[state.key] : undefined) ?? state.sla;
}

const CATALOGUES: Record<string, Record<string, string>> = { am, en };
const text = (key: string, language: string): string =>
    CATALOGUES[language]?.[key] ?? am[key as keyof typeof am] ?? key;

/** A refusal of the engine as the API answers it: who may not act is 403, what cannot happen now is 409. */
function refuse(refusal: Refusal | ClaimRefusal, language: string, caseId: string): never {
    const detail = text(`workflow.refusal.${refusal}`, language);
    switch (refusal) {
        case 'role-required':
        case 'reject-not-allowed':
        case 'separation-of-duties':
        case 'wrong-system-actor':
        case 'not-claimed':
            throw new ForbiddenError({ detail, audit: { reason: refusal, caseId } });
        case 'comment-required':
            throw new ValidationError('validation_failed', {
                detail,
                errors: [{ path: 'comment', code: 'required', message: detail }]
            });
        default:
            throw new ConflictError('invalid_transition', { detail });
    }
}

@Injectable()
export class CasesService {
    /** The roles that read cases (the installed manifests): only their holders may be mentioned on one. */
    private readonly readers: readonly string[];

    constructor(
        private readonly effects: EffectRegistry,
        private readonly forms: FormsService,
        private readonly submissions: SubmissionsService,
        private readonly lookups: RegistryLookups,
        @Inject(SHELL) shell: Shell
    ) {
        this.readers = [...rolePermissions(shell.manifests)]
            .filter(([, granted]) => granted.has('case:read'))
            .map(([role]) => role)
            .sort();
    }

    /** The roles whose holders read cases: whom a comment may mention (the worker's check too). */
    caseReaders(): readonly string[] {
        return this.readers;
    }

    /**
     * Starts a case on a stored workflow version, handled by the caller's unit, with the configuration a service resolved
     * for it (frozen here). For `services` (0.21); the engine never reads the service catalogue.
     */
    async start(
        tx: Tx,
        ctx: DbContext,
        input: { definitionVersionId: string; config?: Record<string, unknown> }
    ): Promise<{ id: string; number: number }> {
        const userId = required(ctx.userId);
        const def = await this.definition(tx, input.definitionVersionId);
        const start = def.states.find((s) => s.kind === 'start');
        if (!start) throw new ConflictError('not_configured', { detail: 'The workflow has no start.' });
        const config = caseConfigSchema.parse(input.config ?? {});
        const next = await tx.execute<{ n: string }>(sql`select nextval('workflow.case_number_seq')::text as n`);
        const row = await insertAudited(tx, cases, {
            regionId: required(ctx.regionId),
            handlingUnitId: required(ctx.unitId),
            number: Number(next.rows[0]?.n),
            definitionVersionId: input.definitionVersionId,
            config,
            configHash: contentHash(config),
            state: start.key,
            startedBy: userId
        });
        await insertAudited(tx, caseEvents, {
            regionId: row.regionId,
            caseId: row.id,
            unitId: row.handlingUnitId,
            kind: 'started',
            toState: start.key,
            actorUserId: userId
        });
        return { id: row.id, number: row.number };
    }

    /** A case as the caller sees it: its steps of units in their scope, its timeline, and what they may do now. */
    async get(tx: Tx, actor: CaseActor, id: string): Promise<CaseOut> {
        const [row] = await tx.select().from(cases).where(eq(cases.id, id));
        if (!row) throw new NotFoundError();
        return this.out(tx, actor, row);
    }

    /** A person's transition out of the case's current state (If-Match: the case's row version). */
    async transition(
        tx: Tx,
        ctx: DbContext,
        actor: CaseActor,
        id: string,
        version: number,
        input: Transition,
        language: string
    ): Promise<CaseOut> {
        const row = await this.locked(tx, id);
        if (row.rowVersion !== version)
            throw new ConflictError('stale_version', { detail: text('workflow.refusal.stale', language) });
        if (row.closedAt) refuse('final-state', language, id);
        const def = await this.definition(tx, row.definitionVersionId);
        const state = stateOf(def, row.state);
        if (!state) refuse('unknown-state', language, id);
        const task = await this.openTask(tx, id);
        // a step one of the role's holders took on is theirs while they hold the role there (0.20b)
        if (task?.claimedBy && task.claimedBy !== actor.userId && (await this.claimHeld(tx, task)))
            refuse('claimed', language, id);
        // the roles count in the task's own unit only; the start is its starter's
        const rolesInUnit = new Set(task && task.unitId === actor.unitId ? actor.roles : []);
        const history = await this.history(tx, row, def);
        const decision = decideAction(
            def,
            row.state,
            input.action,
            { kind: 'person', userId: actor.userId, rolesInUnit },
            { history, facts: row.facts, comment: input.comment !== undefined, startedBy: row.startedBy }
        );
        if (!decision.ok) refuse(decision.refusal, language, id);
        const to = stateOf(def, decision.transition.to);
        if (!to) refuse('unknown-state', language, id);
        const filed = await this.stepAnswers(tx, ctx, actor, row, state, decision.transition, to, input, language);
        await this.advance(tx, ctx, row, def, state, decision.transition, {
            userId: actor.userId,
            task,
            input: filed.answers,
            submissionId: filed.submissionId,
            comment: input.comment,
            history,
            language
        });
        const [after] = await tx.select().from(cases).where(eq(cases.id, id));
        if (!after) throw new NotFoundError();
        return this.out(tx, actor, after);
    }

    /**
     * An event (`event:<name>`) or the timeout out of a wait state, taken by a system actor. Runs in the worker's system
     * context (no person, no scope); the transaction is the caller's.
     */
    async deliver(
        tx: Tx,
        id: string,
        on: string,
        actor: SystemActor,
        language = 'am',
        /** a timer's question: when the wait has no such way out, answer null (nothing written) instead of refusing */
        options: { quiet?: boolean } = {}
    ): Promise<{ from: string; to: string } | null> {
        const row = await this.locked(tx, id);
        // the system acts for the case's unit: its audit rows carry the case's region and scope
        const chain = await this.chain(tx, row.handlingUnitId);
        actFor(tx, {
            regionId: row.regionId,
            unitId: row.handlingUnitId,
            scopePath: chain[chain.length - 1]?.path ?? ''
        });
        if (row.closedAt) return options.quiet ? null : refuse('final-state', language, id);
        const def = await this.definition(tx, row.definitionVersionId);
        const state = stateOf(def, row.state);
        if (!state) return options.quiet ? null : refuse('unknown-state', language, id);
        const decision = decideEvent(def, row.state, on, actor, row.facts);
        if (!decision.ok) return options.quiet ? null : refuse(decision.refusal, language, id);
        // from here a failure (an effect, the next step's assignment) undoes everything: never a half transition
        const history = await this.history(tx, row, def);
        await this.advance(tx, {}, row, def, state, decision.transition, {
            system: actor.id,
            input: {},
            history,
            language
        });
        return { from: row.state, to: decision.transition.to };
    }

    // --- starting, claiming, commenting (task 0.20b) -------------------------------------------------------------------

    /**
     * Takes an open step on: one of the role's holders in the step's unit, not kept off it by separation of duties. The
     * others see whose it is and may not act on it until it is released. Taking it on again is a no-op; a claim whose
     * holder no longer holds the role there (left, revoked, switched off) counts for nothing and is taken over.
     */
    async claim(tx: Tx, actor: CaseActor, caseId: string, taskId: string, language: string): Promise<CaseOut> {
        const row = await this.locked(tx, caseId);
        const task = await this.openStep(tx, row, taskId, language);
        if (task.unitId !== actor.unitId || !actor.roles.includes(task.role)) refuse('role-required', language, caseId);
        const holder = await this.claimHeld(tx, task);
        if (holder && holder !== actor.userId) refuse('claimed', language, caseId);
        if (holder !== actor.userId) {
            const def = await this.definition(tx, row.definitionVersionId);
            const state = stateOf(def, task.stateKey);
            if (state && excludedBySeparation(state, await this.history(tx, row, def)).has(actor.userId))
                refuse('separation-of-duties', language, caseId);
            await updateAudited(tx, caseTasks, task.id, task.rowVersion, {
                claimedBy: actor.userId,
                claimedAt: new Date()
            });
        }
        return this.get(tx, actor, caseId);
    }

    /**
     * Gives a step back to the role's holders: by whoever took it on, or by someone who may reassign steps (`case:reassign`)
     * in its office or one above it (who sees the step: RLS). Anyone else is refused, audited.
     */
    async release(tx: Tx, actor: CaseActor, caseId: string, taskId: string, language: string): Promise<CaseOut> {
        const row = await this.locked(tx, caseId);
        const task = await this.openStep(tx, row, taskId, language);
        const reassign = actor.permissions?.has('case:reassign') === true;
        if (!task.claimedBy || (task.claimedBy !== actor.userId && !reassign)) refuse('not-claimed', language, caseId);
        await updateAudited(tx, caseTasks, task.id, task.rowVersion, { claimedBy: null, claimedAt: null });
        return this.get(tx, actor, caseId);
    }

    /**
     * A comment on the case's timeline, for the staff working on it (internal). The people it mentions must work on the
     * case (an active role in its handling office or one above it); the worker tells them (`case.commented.v1`).
     */
    async comment(tx: Tx, actor: CaseActor, caseId: string, input: CommentCreate, language: string): Promise<CaseOut> {
        const [row] = await tx.select().from(cases).where(eq(cases.id, caseId));
        if (!row) throw new NotFoundError();
        const mentions = [...new Set(input.mentions)];
        if (mentions.length) {
            const found = new Set((await this.casePeople(tx, caseId, null, mentions)).map((p) => p.id));
            const outside = mentions.filter((id) => !found.has(id));
            if (outside.length)
                throw new ValidationError('validation_failed', {
                    errors: outside.map((id) => ({
                        path: 'mentions',
                        code: 'invalid',
                        message: text('workflow.refusal.mention-outside', language),
                        value: id
                    }))
                });
        }
        const event = await insertAudited(tx, caseEvents, {
            regionId: row.regionId,
            caseId,
            unitId: row.handlingUnitId,
            kind: 'comment',
            actorUserId: actor.userId,
            comment: input.text,
            data: { mentions, visibility: 'internal' }
        });
        // nobody is told of their own mention
        const told = mentions.filter((id) => id !== actor.userId);
        if (told.length)
            await emit(
                tx,
                'case.commented.v1',
                { caseId, eventId: event.id, mentions: told },
                { unitId: row.handlingUnitId, regionId: row.regionId }
            );
        return this.get(tx, actor, caseId);
    }

    /** Who a comment on the case may mention: the people working on it, by name. */
    async people(tx: Tx, caseId: string, q: string | undefined): Promise<{ items: PersonRef[] }> {
        const [row] = await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId));
        if (!row) throw new NotFoundError();
        return { items: await this.casePeople(tx, caseId, q ?? null, null) };
    }

    /**
     * The caller's inbox: the open steps of their active unit for the roles they hold there, by due time (overdue first,
     * no SLA last) then the oldest, a page at a time. "Due soon" and "overdue" are the database's clock.
     */
    async inbox(tx: Tx, actor: CaseActor, query: InboxQuery): Promise<Inbox> {
        if (actor.roles.length === 0) return { items: [], nextCursor: null };
        const dueKey = sql`coalesce(${caseTasks.dueAt}, 'infinity'::timestamptz)`;
        const soon = sql`now() + make_interval(hours => ${DUE_SOON_HOURS})`;
        const rows = await tx
            .select({
                task: caseTasks,
                number: cases.number,
                startedBy: cases.startedBy,
                versionId: cases.definitionVersionId,
                workflowId: workflowDefinitions.id,
                workflowName: workflowDefinitions.name,
                sla: sql<SlaState>`case when ${caseTasks.dueAt} is null then 'none'
                                        when ${caseTasks.dueAt} <= now() then 'overdue'
                                        when ${caseTasks.dueAt} <= ${soon} then 'due-soon'
                                        else 'on-time' end`
            })
            .from(caseTasks)
            .innerJoin(cases, eq(cases.id, caseTasks.caseId))
            .innerJoin(workflowDefinitionVersions, eq(workflowDefinitionVersions.id, cases.definitionVersionId))
            .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowDefinitionVersions.definitionId))
            .where(
                and(
                    eq(caseTasks.status, 'open'),
                    eq(caseTasks.unitId, actor.unitId),
                    inArray(caseTasks.role, [...actor.roles]),
                    query.claim === 'mine'
                        ? eq(caseTasks.claimedBy, actor.userId)
                        : query.claim === 'unclaimed'
                          ? isNull(caseTasks.claimedBy)
                          : undefined,
                    query.sla === 'overdue'
                        ? sql`${caseTasks.dueAt} <= now()`
                        : query.sla === 'due-soon'
                          ? sql`${caseTasks.dueAt} > now() and ${caseTasks.dueAt} <= ${soon}`
                          : undefined,
                    query.state ? eq(caseTasks.stateKey, query.state) : undefined,
                    query.number ? eq(cases.number, query.number) : undefined,
                    query.after
                        ? sql`(${dueKey}, ${caseTasks.createdAt}, ${caseTasks.id}) >
                              (select coalesce(a.due_at, 'infinity'::timestamptz), a.created_at, a.id
                                 from workflow.case_tasks a where a.id = ${query.after}::uuid)`
                        : undefined
                )
            )
            .orderBy(dueKey, asc(caseTasks.createdAt), asc(caseTasks.id))
            .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const defs = await this.definitions(
            tx,
            page.map((r) => r.versionId)
        );
        const histories = await this.histories(
            tx,
            page.map((r) => ({ id: r.task.caseId, startedBy: r.startedBy, def: defs.get(r.versionId) }))
        );
        const units = await unitRefs(
            tx,
            page.flatMap((r) => [r.task.unitId, r.task.routedFromUnitId])
        );
        const label = (id: string): UnitLabel => units.get(id) ?? { id, code: '', name: {} };
        const names = await namesOf(
            tx,
            page.map((r) => r.task.claimedBy)
        );
        // a claim counts while its holder holds the role here (one lookup per role on the page)
        const holders = new Map<string, Set<string>>();
        for (const role of new Set(page.filter((r) => r.task.claimedBy).map((r) => r.task.role)))
            holders.set(role, await this.holdersOf(tx, actor.unitId, role));
        const heldBy = (task: TaskRow) =>
            task.claimedBy && holders.get(task.role)?.has(task.claimedBy) ? task.claimedBy : null;
        return {
            items: page.map(({ task, ...r }): InboxItem => {
                const def = defs.get(r.versionId);
                const state = def ? stateOf(def, task.stateKey) : undefined;
                const excluded = state ? excludedBySeparation(state, histories.get(task.caseId) ?? []) : new Set();
                return {
                    taskId: task.id,
                    caseId: task.caseId,
                    caseNumber: r.number,
                    workflow: { id: r.workflowId, name: r.workflowName },
                    state: task.stateKey,
                    stateLabel: state?.label ?? null,
                    role: task.role,
                    unit: label(task.unitId),
                    routedFrom: task.routedFromUnitId ? label(task.routedFromUnitId) : null,
                    dueAt: task.dueAt?.toISOString() ?? null,
                    sla: r.sla,
                    claimedBy: personOf(names, heldBy(task)),
                    mayAct: !excluded.has(actor.userId),
                    openedAt: task.createdAt.toISOString()
                };
            }),
            nextCursor: rows.length > query.limit ? (page[page.length - 1]?.task.id ?? null) : null
        };
    }

    /** The inbox's counts: the caller's open steps (as `inbox` lists them), those overdue, those nobody took on. */
    async inboxCount(tx: Tx, actor: CaseActor): Promise<{ open: number; overdue: number; unclaimed: number }> {
        if (actor.roles.length === 0) return { open: 0, overdue: 0, unclaimed: 0 };
        const [row] = await tx
            .select({
                open: sql<number>`count(*)::int`,
                overdue: sql<number>`count(*) filter (where ${caseTasks.dueAt} <= now())::int`,
                unclaimed: sql<number>`count(*) filter (where ${caseTasks.claimedBy} is null)::int`
            })
            .from(caseTasks)
            .where(
                and(
                    eq(caseTasks.status, 'open'),
                    eq(caseTasks.unitId, actor.unitId),
                    inArray(caseTasks.role, [...actor.roles])
                )
            );
        return { open: row?.open ?? 0, overdue: row?.overdue ?? 0, unclaimed: row?.unclaimed ?? 0 };
    }

    // --- the transition's work ----------------------------------------------------------------------------------------

    private async advance(
        tx: Tx,
        ctx: DbContext,
        row: CaseRow,
        def: WorkflowDefinition,
        from: WorkflowState,
        t: WorkflowTransition,
        by: {
            userId?: string;
            system?: string;
            task?: TaskRow;
            input: Record<string, unknown>;
            /** the step form's answers filed with it, shown on the case page as that step's */
            submissionId?: string;
            comment?: string;
            history: readonly StepHistory[];
            language: string;
        }
    ): Promise<void> {
        const action = t.action ?? t.on ?? '';
        // effects, in order, in this transaction: one that fails undoes the whole transition
        const facts: Record<string, unknown> = { ...row.facts };
        for (const ref of t.effects ?? []) {
            const key = effectKeyOf(ref);
            const effect = this.effects.get(key);
            if (!effect) throw new ConflictError('not_configured', { detail: `The effect ${key} is not installed.` });
            const argument = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : undefined;
            const contract = this.effects.contract(key);
            const result = await effect.run({
                tx,
                ctx,
                caseId: row.id,
                regionId: row.regionId,
                handlingUnitId: row.handlingUnitId,
                argument,
                input: contract ? await this.contractedInput(tx, row, key, contract) : by.input,
                facts
            });
            if (result?.facts) Object.assign(facts, result.facts);
        }
        if (by.task)
            await updateAudited(tx, caseTasks, by.task.id, by.task.rowVersion, {
                status: 'done',
                actedBy: by.userId ?? null,
                action,
                closedAt: new Date()
            });
        const to = stateOf(def, t.to);
        if (!to) refuse('unknown-state', by.language, row.id);
        const closed = to.kind === 'end';
        // a wait with an SLA is due on the handling unit's calendar; its timeout is delivered then (0.20a)
        const waitSla = to.kind === 'wait' ? slaOfState(row.config, to) : undefined;
        const waitDue = waitSla
            ? await dueAt(
                  tx,
                  (await this.chain(tx, row.handlingUnitId)).map((u) => u.id),
                  waitSla
              )
            : null;
        await updateAudited(tx, cases, row.id, row.rowVersion, {
            state: to.key,
            facts,
            dueAt: waitDue,
            closedAt: closed ? new Date() : null
        });
        if (waitDue)
            await emit(
                tx,
                'case.wait-due.v1',
                { caseId: row.id, state: to.key },
                { unitId: row.handlingUnitId, regionId: row.regionId, availableAt: waitDue }
            );
        await insertAudited(tx, caseEvents, {
            regionId: row.regionId,
            caseId: row.id,
            unitId: row.handlingUnitId,
            kind: 'transition',
            fromState: from.key,
            toState: to.key,
            action,
            actorUserId: by.userId ?? null,
            systemActor: by.system ?? null,
            comment: by.comment ?? null,
            data:
                t.effects?.length || by.submissionId
                    ? {
                          ...(t.effects?.length ? { effects: t.effects } : {}),
                          ...(by.submissionId ? { submissionId: by.submissionId } : {})
                      }
                    : null
        });
        if (to.kind === 'task') {
            const history = by.userId ? [...by.history, { state: from.key, userId: by.userId }] : by.history;
            await this.assign(tx, ctx, row, to, history, by.language);
        }
        await emit(
            tx,
            'case.transitioned.v1',
            { caseId: row.id, from: from.key, to: to.key, action, closed },
            { unitId: row.handlingUnitId, regionId: row.regionId }
        );
    }

    /** Opens the task of `state`: in the unit its rule names, or up the tree when separation of duties leaves nobody. */
    private async assign(
        tx: Tx,
        ctx: DbContext,
        row: CaseRow,
        state: WorkflowState,
        history: readonly StepHistory[],
        language: string
    ): Promise<void> {
        const assignee = state.assignee;
        if (!assignee) throw new ConflictError('not_configured', { detail: `The step ${state.key} has no assignee.` });
        const chain = await this.chain(tx, row.handlingUnitId);
        const config = caseConfigSchema.safeParse(row.config);
        const assigned = assigneeUnit(assignee.unit, chain, config.success ? config.data.approval_unit : undefined);
        if (!assigned.ok)
            throw new ConflictError('not_configured', {
                detail: text(`workflow.assignment.${assigned.reason}`, language)
            });
        let unit = assigned.unit;
        let routedFrom: string | null = null;
        const excluded = excludedBySeparation(state, history);
        if (excluded.size) {
            const upTo = chain.slice(0, chain.findIndex((u) => u.id === assigned.unit.id) + 1);
            const holders = new Map<string, readonly string[]>();
            for (const u of upTo) holders.set(u.id, await this.holders(tx, ctx, u.id, assignee.role));
            const routed = routeStep(upTo, (id) => holders.get(id) ?? [], excluded);
            if (!routed)
                throw new ConflictError('invalid_transition', {
                    detail: text('workflow.refusal.no-eligible', language)
                });
            unit = routed.unit;
            if (routed.hops > 0) routedFrom = assigned.unit.id;
        }
        const taskId = newId();
        // its SLA (the service's for this case, else the workflow's) on the calendar of the unit it is in
        const sla = slaOfState(row.config, state);
        const due = sla
            ? await dueAt(
                  tx,
                  chain.slice(0, chain.findIndex((u) => u.id === unit.id) + 1).map((u) => u.id),
                  sla
              )
            : null;
        const values = {
            id: taskId,
            regionId: row.regionId,
            caseId: row.id,
            unitId: unit.id,
            stateKey: state.key,
            role: assignee.role,
            routedFromUnitId: routedFrom,
            dueAt: due
        };
        const path = chain.find((u) => u.id === unit.id)?.path ?? '';
        if (!ctx.scopePath || withinScope(path, ctx.scopePath)) await insertAudited(tx, caseTasks, values);
        else {
            // above the caller's scope: the reviewed function checks the case, the unit and the role again
            await tx.execute(
                sql`select workflow.open_task(${taskId}::uuid, ${row.id}::uuid, ${state.key}, ${unit.id}::uuid,
                                              ${assignee.role}, ${routedFrom}::uuid, ${due}::timestamptz)`
            );
            await recordEvent(tx, {
                type: 'workflow.task.opened',
                table: caseTasks,
                rowId: taskId,
                data: { caseId: row.id, unitId: unit.id, role: assignee.role, state: state.key }
            });
        }
        // the SLA timer: the relay hands it over when it is due (the sweep catches a lost one)
        if (due)
            await emit(
                tx,
                'case-task.due.v1',
                { taskId, caseId: row.id },
                { unitId: row.handlingUnitId, regionId: row.regionId, availableAt: due }
            );
        if (routedFrom)
            await insertAudited(tx, caseEvents, {
                regionId: row.regionId,
                caseId: row.id,
                unitId: row.handlingUnitId,
                kind: 'routed',
                fromState: state.key,
                toState: state.key,
                data: { assignedUnitId: routedFrom, unitId: unit.id, reason: 'separation_of_duties' }
            });
    }

    /** Who holds `role` in a unit: through the reviewed function for a person (scope-checked), directly for the system. */
    private async holders(tx: Tx, ctx: DbContext, unitId: string, role: string): Promise<string[]> {
        const result = ctx.scopePath
            ? await tx.execute<{ id: string }>(
                  sql`select h as id from workflow.role_holders(${unitId}::uuid, ${role}) h`
              )
            : await tx.execute<{ id: string }>(
                  sql`select ra.user_id as id from kernel.role_assignments ra join kernel.users u on u.id = ra.user_id
                        join kernel.org_units ou on ou.id = ra.unit_id
                       where ra.unit_id = ${unitId}::uuid and ra.role_key = ${role} and ra.valid_from <= now()
                         and (ra.valid_to is null or ra.valid_to > now()) and u.active
                         and not exists (select 1 from kernel.org_units a where a.path @> ou.path and not a.active)`
              );
        return result.rows.map((r) => r.id);
    }

    /** The units from the region down to `unitId`, with their level keys and paths. */
    private async chain(tx: Tx, unitId: string): Promise<(UnitRef & { path: string })[]> {
        const rows = await tx
            .select({ id: orgUnits.id, levelKey: orgUnits.levelKey, path: sql<string>`${orgUnits.path}::text` })
            .from(orgUnits)
            .where(sql`${orgUnits.path} @> (select h.path from kernel.org_units h where h.id = ${unitId}::uuid)`)
            .orderBy(sql`nlevel(${orgUnits.path})`);
        if (!rows.some((r) => r.id === unitId)) throw new NotFoundError();
        return rows;
    }

    /**
     * An effect's input by its contract (task 0.21d): the values of the case's request form (the version its service
     * froze), read through the service version's input map. A required one missing (a request filed before the contract
     * existed, a form changed outside the checks) refuses the transition: the effect never runs on less than it needs.
     */
    private async contractedInput(
        tx: Tx,
        row: CaseRow,
        key: string,
        contract: EffectContract
    ): Promise<Record<string, unknown>> {
        const config = row.config as { formVersionId?: unknown; inputMap?: Record<string, Record<string, string>> };
        const [request] =
            typeof config.formVersionId === 'string'
                ? await tx
                      .select({ answers: submissions.answers })
                      .from(submissions)
                      .where(and(eq(submissions.caseId, row.id), eq(submissions.formVersionId, config.formVersionId)))
                      .orderBy(asc(submissions.createdAt))
                      .limit(1)
                : [];
        const { input, missing } = contractInput(contract, request?.answers ?? {}, config.inputMap?.[key]);
        if (missing.length)
            throw new ValidationError('validation_failed', {
                detail: `The effect ${key} needs values the request does not hold.`,
                errors: missing.map((path) => ({ path: `input.${path}`, code: 'contract_unmet', message: path }))
            });
        return input;
    }

    /** The step form's answers, filed on the case as a submission of the version the step names. */
    private async stepAnswers(
        tx: Tx,
        ctx: DbContext,
        actor: CaseActor,
        row: CaseRow,
        state: WorkflowState,
        t: WorkflowTransition,
        to: WorkflowState,
        input: Transition,
        language: string
    ): Promise<{ answers: Record<string, unknown>; submissionId?: string }> {
        const wanted = needsForm(state, t, to) && state.stepForm ? parseStepForm(state.stepForm) : null;
        if (!wanted) {
            if (input.answers !== undefined)
                throw new ValidationError('validation_failed', {
                    errors: [{ path: 'answers', code: 'invalid', message: text('workflow.refusal.no-form', language) }]
                });
            return { answers: {} };
        }
        if (input.answers === undefined)
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'answers', code: 'required', message: text('workflow.refusal.form-needed', language) }]
            });
        const version = await this.forms.stepVersion(tx, wanted.key, wanted.number);
        if (!version)
            throw new ConflictError('not_configured', {
                detail: `The step form ${state.stepForm ?? ''} is not available.`
            });
        const submission = await this.submissions.create(
            tx,
            ctx,
            actor.roles,
            { formId: version.formId, formVersionId: version.versionId, answers: input.answers },
            this.lookups,
            language,
            { caseId: row.id, handlingUnitId: row.handlingUnitId }
        );
        return { answers: submission.answers, submissionId: submission.id };
    }

    // --- reading ------------------------------------------------------------------------------------------------------

    private async locked(tx: Tx, id: string): Promise<CaseRow> {
        const [row] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
        if (!row) throw new NotFoundError();
        return row;
    }

    private async definition(tx: Tx, versionId: string): Promise<WorkflowDefinition> {
        const [version] = await tx
            .select({ definition: workflowDefinitionVersions.definition })
            .from(workflowDefinitionVersions)
            .where(eq(workflowDefinitionVersions.id, versionId));
        if (!version) throw new NotFoundError();
        // stored only once checked (0.19a): parsed for its types
        return workflowDefinitionSchema.parse(version.definition);
    }

    private async openTask(tx: Tx, caseId: string): Promise<TaskRow | undefined> {
        const [task] = await tx
            .select()
            .from(caseTasks)
            .where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.status, 'open')))
            .for('update');
        return task;
    }

    /** Who acted on which step: the start's starter, then every person's transition. */
    private async history(tx: Tx, row: CaseRow, def: WorkflowDefinition): Promise<StepHistory[]> {
        return (await this.histories(tx, [{ id: row.id, startedBy: row.startedBy, def }])).get(row.id) ?? [];
    }

    /** `history` of several cases in one query (the inbox's page). */
    private async histories(
        tx: Tx,
        of: readonly { id: string; startedBy: string; def: WorkflowDefinition | undefined }[]
    ): Promise<Map<string, StepHistory[]>> {
        const out = new Map<string, StepHistory[]>();
        if (of.length === 0) return out;
        for (const c of of) {
            const start = c.def?.states.find((s) => s.kind === 'start');
            out.set(c.id, start ? [{ state: start.key, userId: c.startedBy }] : []);
        }
        const steps = await tx
            .select({ caseId: caseEvents.caseId, state: caseEvents.fromState, userId: caseEvents.actorUserId })
            .from(caseEvents)
            .where(and(inArray(caseEvents.caseId, [...out.keys()]), eq(caseEvents.kind, 'transition')))
            .orderBy(asc(caseEvents.createdAt), asc(caseEvents.id));
        for (const s of steps) if (s.state && s.userId) out.get(s.caseId)?.push({ state: s.state, userId: s.userId });
        return out;
    }

    /**
     * Who holds a step's claim, if they still may: the role in the step's unit, an active person in an active office (the
     * reviewed `workflow.role_holders`). A claim of someone who left counts for nothing.
     */
    private async claimHeld(tx: Tx, task: TaskRow): Promise<string | null> {
        if (!task.claimedBy) return null;
        return (await this.holdersOf(tx, task.unitId, task.role)).has(task.claimedBy) ? task.claimedBy : null;
    }

    private async holdersOf(tx: Tx, unitId: string, role: string): Promise<Set<string>> {
        const result = await tx.execute<{ id: string }>(
            sql`select h as id from workflow.role_holders(${unitId}::uuid, ${role}) h`
        );
        return new Set(result.rows.map((r) => r.id));
    }

    /** Stored definitions by version id (checked when stored: parsed for their types). */
    private async definitions(tx: Tx, versionIds: readonly string[]): Promise<Map<string, WorkflowDefinition>> {
        const wanted = [...new Set(versionIds)];
        if (wanted.length === 0) return new Map();
        const rows = await tx
            .select({ id: workflowDefinitionVersions.id, definition: workflowDefinitionVersions.definition })
            .from(workflowDefinitionVersions)
            .where(inArray(workflowDefinitionVersions.id, wanted));
        return new Map(rows.map((r) => [r.id, workflowDefinitionSchema.parse(r.definition)]));
    }

    /** The case's step that is still open, for a claim (its case locked by the caller). */
    private async openStep(tx: Tx, row: CaseRow, taskId: string, language: string): Promise<TaskRow> {
        const [task] = await tx
            .select()
            .from(caseTasks)
            .where(and(eq(caseTasks.id, taskId), eq(caseTasks.caseId, row.id)))
            .for('update');
        if (!task) throw new NotFoundError();
        if (task.status !== 'open' || row.closedAt) refuse('task-closed', language, row.id);
        return task;
    }

    /** The people working on a case the caller sees (the reviewed `workflow.case_people`), by name or among `ids`. */
    private async casePeople(
        tx: Tx,
        caseId: string,
        q: string | null,
        ids: readonly string[] | null
    ): Promise<PersonRef[]> {
        const result = await tx.execute<{ user_id: string; display_name: string }>(
            sql`select user_id, display_name from workflow.case_people(${caseId}::uuid, ${q}::text,
                    ${ids ? `{${ids.join(',')}}` : null}::uuid[], ${`{${this.readers.join(',')}}`}::text[])`
        );
        return result.rows.map((r) => ({ id: r.user_id, name: r.display_name }));
    }

    private async out(tx: Tx, actor: CaseActor, row: CaseRow): Promise<CaseOut> {
        const [version] = await tx
            .select({
                id: workflowDefinitionVersions.definitionId,
                number: workflowDefinitionVersions.number,
                definition: workflowDefinitionVersions.definition
            })
            .from(workflowDefinitionVersions)
            .where(eq(workflowDefinitionVersions.id, row.definitionVersionId));
        if (!version) throw new NotFoundError();
        const def = workflowDefinitionSchema.parse(version.definition);
        // the tasks the caller can see (RLS: their unit's and those below it)
        const tasks = await tx
            .select()
            .from(caseTasks)
            .where(eq(caseTasks.caseId, row.id))
            .orderBy(asc(caseTasks.createdAt));
        const events = await tx
            .select()
            .from(caseEvents)
            .where(eq(caseEvents.caseId, row.id))
            .orderBy(asc(caseEvents.createdAt), asc(caseEvents.id));
        const units = await unitRefs(tx, [row.handlingUnitId, ...tasks.flatMap((t) => [t.unitId, t.routedFromUnitId])]);
        const label = (id: string): UnitLabel => units.get(id) ?? { id, code: '', name: {} };
        const open = tasks.find((t) => t.status === 'open');
        // a step another person took on is theirs while they hold the role there: the caller has no action on it
        const held = open ? await this.claimHeld(tx, open) : null;
        const takenByOther = held !== null && held !== actor.userId;
        const rolesInUnit = new Set(open && open.unitId === actor.unitId && !takenByOther ? actor.roles : []);
        const actions =
            row.closedAt || takenByOther
                ? []
                : actionsFor(def, row.state, { kind: 'person', userId: actor.userId, rolesInUnit }, row.startedBy);
        const current = stateOf(def, row.state);
        // each action's transition, and the step form it files its answers on (the version the step names)
        const actionDetails = await Promise.all(
            actions.map(async (action) => {
                const t = def.transitions.find((x) => x.from === row.state && x.action === action);
                const step =
                    current && t && current.stepForm && needsForm(current, t, stateOf(def, t.to))
                        ? parseStepForm(current.stepForm)
                        : null;
                const version = step ? await this.forms.stepVersion(tx, step.key, step.number) : null;
                return {
                    action,
                    t,
                    needs: step !== null,
                    form: version ? { formId: version.formId, versionId: version.versionId } : null
                };
            })
        );
        const [{ name: workflowName } = { name: {} }] = await tx
            .select({ name: workflowDefinitions.name })
            .from(workflowDefinitions)
            .where(eq(workflowDefinitions.id, version.id));
        // the step forms filed on the case, by the transition that filed each
        const filedAt = new Map(
            events.flatMap((e) => {
                const id = e.data?.submissionId;
                return typeof id === 'string' && e.fromState ? [[id, e.fromState] as const] : [];
            })
        );
        // the request form the case was started with (task 0.21c): filed with the case, by no transition
        const requestVersion = (row.config as { formVersionId?: unknown }).formVersionId;
        const startKey = def.states.find((s) => s.kind === 'start')?.key ?? '';
        const filed = (await this.submissions.ofCase(tx, actor.roles, row.id)).filter(
            (s) => filedAt.has(s.id) || (typeof requestVersion === 'string' && s.formVersion.id === requestVersion)
        );
        for (const s of filed) if (!filedAt.has(s.id)) filedAt.set(s.id, startKey);
        const mentionsOf = (e: (typeof events)[number]): string[] =>
            e.kind === 'comment' && Array.isArray(e.data?.mentions)
                ? e.data.mentions.filter((m): m is string => typeof m === 'string')
                : [];
        const names = await namesOf(tx, [
            row.startedBy,
            ...tasks.flatMap((t) => [t.actedBy, t.claimedBy]),
            ...events.flatMap((e) => [e.actorUserId, ...mentionsOf(e)]),
            ...filed.map((s) => s.submittedBy)
        ]);
        // the database's clock, as the inbox's
        const now = new Date(
            (await tx.execute<{ now: Date | string }>(sql`select now() as now`)).rows[0]?.now ?? Date.now()
        ).getTime();
        return {
            id: row.id,
            version: row.rowVersion,
            number: row.number,
            state: row.state,
            closed: row.closedAt !== null,
            handlingUnit: label(row.handlingUnitId),
            workflow: {
                id: version.id,
                versionId: row.definitionVersionId,
                number: version.number,
                name: workflowName
            },
            stateLabels: Object.fromEntries(def.states.flatMap((s) => (s.label ? [[s.key, s.label]] : []))),
            startedBy: row.startedBy,
            startedByName: names.get(row.startedBy) ?? null,
            actions,
            actionDetails: actionDetails.map(({ action, t, needs, form }) => ({
                action,
                label: t?.label ?? null,
                commentRequired: t?.commentRequired === true,
                needsForm: needs,
                form
            })),
            tasks: tasks.map((t) => ({
                id: t.id,
                state: t.stateKey,
                role: t.role,
                unit: label(t.unitId),
                status: t.status,
                routedFrom: t.routedFromUnitId ? label(t.routedFromUnitId) : null,
                actedBy: t.actedBy,
                actedByName: t.actedBy ? (names.get(t.actedBy) ?? null) : null,
                action: t.action,
                dueAt: t.dueAt?.toISOString() ?? null,
                sla: t.status === 'open' ? slaOf(t.dueAt, now) : 'none',
                claimedBy: personOf(names, t.status === 'open' && t.id === open?.id ? held : t.claimedBy),
                openedAt: t.createdAt.toISOString(),
                closedAt: t.closedAt?.toISOString() ?? null
            })),
            events: events.map((e) => ({
                id: e.id,
                kind: e.kind,
                from: e.fromState,
                to: e.toState,
                action: e.action,
                actorUserId: e.actorUserId,
                actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
                systemActor: e.systemActor,
                comment: e.comment,
                mentions: mentionsOf(e).flatMap((id) => personOf(names, id) ?? []),
                visibility: e.kind === 'comment' ? 'internal' : null,
                at: e.createdAt.toISOString()
            })),
            steps: filed.map((s) => ({
                submissionId: s.id,
                state: filedAt.get(s.id) ?? '',
                formId: s.formId,
                formVersion: s.formVersion.number,
                form: s.document,
                answers: s.answers,
                masked: s.masked,
                submittedBy: personOf(names, s.submittedBy),
                at: s.createdAt
            })),
            canComment: actor.permissions?.has('case:comment') ?? false,
            createdAt: row.createdAt.toISOString(),
            closedAt: row.closedAt?.toISOString() ?? null
        };
    }
}

/** Where an open step stands against its due time at `now` (the database's clock, as the inbox says it). */
function slaOf(dueAt: Date | null, now: number): SlaState {
    if (!dueAt) return 'none';
    if (dueAt.getTime() <= now) return 'overdue';
    return dueAt.getTime() <= now + DUE_SOON_HOURS * 3_600_000 ? 'due-soon' : 'on-time';
}

/** Staff names (users are a regional record: the region reads them). */
async function namesOf(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await tx
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, wanted));
    return new Map(rows.map((r) => [r.id, r.name]));
}

const personOf = (names: ReadonlyMap<string, string>, id: string | null): PersonRef | null =>
    id ? { id, name: names.get(id) ?? '' } : null;

/** Whether a transition out of a step files its form: not a reject, nor a case sent back to its start for correction. */
function needsForm(state: WorkflowState, t: WorkflowTransition, to: WorkflowState | undefined): boolean {
    return Boolean(state.stepForm) && t.action !== 'reject' && to?.kind !== 'start';
}

function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detail: 'This needs a signed-in person in an active unit.' });
    return value;
}
