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
import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { unitRefs, withinScope, type UnitRef as UnitLabel } from '@itrms/kernel/org';
import { emit } from '@itrms/kernel/outbox';
import { orgUnits } from '@itrms/kernel/tables';
import { FormsService, RegistryLookups, SubmissionsService } from '@itrms/forms/api';
import {
    effectKeyOf,
    parseStepForm,
    workflowDefinitionSchema,
    workflowUnitRuleSchema,
    type WorkflowDefinition,
    type WorkflowState,
    type WorkflowTransition
} from '@itrms/schemas';
import { z } from 'zod';

import type { CaseOut, Transition } from '../contracts';
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
import { caseEvents, cases, caseTasks, workflowDefinitionVersions } from './workflow.table';

type CaseRow = typeof cases.$inferSelect;
type TaskRow = typeof caseTasks.$inferSelect;

/** Who acts: the signed-in person, their active unit and the roles they hold there. */
export interface CaseActor {
    userId: string;
    unitId: string;
    roles: readonly string[];
}

/** The configuration a service freezes on a case (0.21 resolves it); the engine reads `approval_unit`. */
export const caseConfigSchema = z
    .object({ approval_unit: workflowUnitRuleSchema.optional() })
    .catchall(z.unknown())
    .refine((c) => c.approval_unit !== '${approval_unit}', 'approval_unit names a unit rule');
export type CaseConfig = z.infer<typeof caseConfigSchema>;

const CATALOGUES: Record<string, Record<string, string>> = { am, en };
const text = (key: string, language: string): string =>
    CATALOGUES[language]?.[key] ?? am[key as keyof typeof am] ?? key;

/** A refusal of the engine as the API answers it: who may not act is 403, what cannot happen now is 409. */
function refuse(refusal: Refusal, language: string, caseId: string): never {
    const detail = text(`workflow.refusal.${refusal}`, language);
    switch (refusal) {
        case 'role-required':
        case 'reject-not-allowed':
        case 'separation-of-duties':
        case 'wrong-system-actor':
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
    constructor(
        private readonly effects: EffectRegistry,
        private readonly forms: FormsService,
        private readonly submissions: SubmissionsService,
        private readonly lookups: RegistryLookups
    ) {}

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
        const answers = await this.stepAnswers(tx, ctx, actor, row, state, decision.transition, to, input, language);
        await this.advance(tx, ctx, row, def, state, decision.transition, {
            userId: actor.userId,
            task,
            input: answers,
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
            const result = await effect.run({
                tx,
                ctx,
                caseId: row.id,
                regionId: row.regionId,
                handlingUnitId: row.handlingUnitId,
                argument,
                input: by.input,
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
        const waitDue =
            to.kind === 'wait' && to.sla
                ? await dueAt(
                      tx,
                      (await this.chain(tx, row.handlingUnitId)).map((u) => u.id),
                      to.sla
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
            data: t.effects?.length ? { effects: t.effects } : null
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
        // its SLA on the calendar of the unit it is in
        const due = state.sla
            ? await dueAt(
                  tx,
                  chain.slice(0, chain.findIndex((u) => u.id === unit.id) + 1).map((u) => u.id),
                  state.sla
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
    ): Promise<Record<string, unknown>> {
        // a reject, or a case sent back to its start for correction, takes no form; a step without one takes no answers
        const sentBack = to.kind === 'start';
        const wanted = state.stepForm && t.action !== 'reject' && !sentBack ? parseStepForm(state.stepForm) : null;
        if (!wanted) {
            if (input.answers !== undefined)
                throw new ValidationError('validation_failed', {
                    errors: [{ path: 'answers', code: 'invalid', message: text('workflow.refusal.no-form', language) }]
                });
            return {};
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
        return submission.answers;
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
        const start = def.states.find((s) => s.kind === 'start');
        const steps = await tx
            .select({ state: caseEvents.fromState, userId: caseEvents.actorUserId })
            .from(caseEvents)
            .where(and(eq(caseEvents.caseId, row.id), eq(caseEvents.kind, 'transition')))
            .orderBy(asc(caseEvents.createdAt));
        return [
            ...(start ? [{ state: start.key, userId: row.startedBy }] : []),
            ...steps.flatMap((s) => (s.state && s.userId ? [{ state: s.state, userId: s.userId }] : []))
        ];
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
        const rolesInUnit = new Set(open && open.unitId === actor.unitId ? actor.roles : []);
        return {
            id: row.id,
            version: row.rowVersion,
            number: row.number,
            state: row.state,
            closed: row.closedAt !== null,
            handlingUnit: label(row.handlingUnitId),
            workflow: { id: version.id, versionId: row.definitionVersionId, number: version.number },
            startedBy: row.startedBy,
            actions: row.closedAt
                ? []
                : actionsFor(def, row.state, { kind: 'person', userId: actor.userId, rolesInUnit }, row.startedBy),
            tasks: tasks.map((t) => ({
                id: t.id,
                state: t.stateKey,
                role: t.role,
                unit: label(t.unitId),
                status: t.status,
                routedFrom: t.routedFromUnitId ? label(t.routedFromUnitId) : null,
                actedBy: t.actedBy,
                action: t.action,
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
                systemActor: e.systemActor,
                comment: e.comment,
                at: e.createdAt.toISOString()
            })),
            createdAt: row.createdAt.toISOString(),
            closedAt: row.closedAt?.toISOString() ?? null
        };
    }
}

function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detail: 'This needs a signed-in person in an active unit.' });
    return value;
}
