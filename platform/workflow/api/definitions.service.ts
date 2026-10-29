/**
 * Workflow definitions (task 0.19a): a definition is checked by the engine (structure, and the roles, effects and step forms
 * the installation knows) before a version is stored; versions are immutable and content-hashed, so sending the same
 * content again names the version that holds it (and makes it the latest again: a rollback). Every write is audited in
 * its transaction (insertAudited, updateAudited); the audit holds a version's hash, never its content.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { EffectRegistry } from '@itrms/kernel/effects';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { rolePermissions, SHELL, type Shell } from '@itrms/kernel/iam';
import { unitRefs, withinScope } from '@itrms/kernel/org';
import { FormsService } from '@itrms/forms/api';
import { parseStepForm, type WorkflowDefinition } from '@itrms/schemas';
import type { z } from 'zod';

import type {
    WorkflowUpdate,
    WorkflowCheck,
    WorkflowCreate,
    WorkflowOut,
    WorkflowVersionOut,
    WorkflowVersionSummary,
    workflowListQuerySchema
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { checkDefinition, type CheckProblem } from './engine/check';
import { workflowDefinitions, workflowDefinitionVersions } from './workflow.table';

type DefinitionRow = typeof workflowDefinitions.$inferSelect;
type VersionRow = typeof workflowDefinitionVersions.$inferSelect;

const CATALOGUES: Record<string, Record<string, string>> = { am, en };

/** A check problem in the reader's language (Amharic when the language has no catalogue here). */
function messageOf(problem: CheckProblem, language: string): string {
    const key = `workflow.check.${problem.code}`;
    let text = CATALOGUES[language]?.[key] ?? am[key as keyof typeof am] ?? key;
    for (const [name, value] of Object.entries(problem.values)) text = text.replaceAll(`{${name}}`, value);
    return text;
}

const required = (value: string | undefined): string => {
    if (!value) throw new ForbiddenError({ detail: 'This needs an active unit.' });
    return value;
};

/** A unique violation of `constraint`, wherever it is in the error's causes (the driver's error is wrapped). */
function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
}

@Injectable()
export class WorkflowDefinitionsService {
    constructor(
        @Inject(SHELL) private readonly shell: Shell,
        private readonly effects: EffectRegistry,
        private readonly forms: FormsService
    ) {}

    /**
     * The roles a step may name: those the installed modules define and grant `case:act` (a step on any other role could
     * never be taken: its holders are refused at the door).
     */
    private roles(): Set<string> {
        const granted = rolePermissions(this.shell.manifests);
        return new Set([...granted].filter(([, permissions]) => permissions.has('case:act')).map(([role]) => role));
    }

    /**
     * The engine's checks on `raw`, with what the installation knows, for a workflow owned at `ownerPath` (its step forms
     * must be ones every unit running it can read); problems in the reader's language.
     */
    async check(
        tx: Tx,
        raw: unknown,
        ownerPath: string,
        language: string
    ): Promise<WorkflowCheck & { definition: WorkflowDefinition | null }> {
        const shape = checkDefinition(raw);
        let result = shape;
        if (shape.definition) {
            const refs = shape.definition.states.flatMap((s) => {
                const ref = s.stepForm ? parseStepForm(s.stepForm) : null;
                return ref ? [ref] : [];
            });
            const stepForms = await this.forms.existingVersions(tx, refs, ownerPath);
            result = checkDefinition(raw, { roles: this.roles(), effects: this.effects.keys(), stepForms });
        }
        return {
            ok: result.definition !== null && result.problems.length === 0,
            definition: result.definition,
            problems: result.problems.map((p) => ({
                code: p.code,
                path: `definition.${p.path}`,
                message: messageOf(p, language)
            }))
        };
    }

    /** The checked definition, or a 422 listing every problem. */
    private async valid(tx: Tx, raw: unknown, ownerPath: string, language: string): Promise<WorkflowDefinition> {
        const { definition, problems } = await this.check(tx, raw, ownerPath, language);
        if (!definition || problems.length)
            throw new ValidationError('validation_failed', {
                detail: 'The workflow is not valid: fix what is listed.',
                errors: problems.slice(0, 100)
            });
        return definition;
    }

    async create(tx: Tx, ctx: DbContext, input: WorkflowCreate, language: string): Promise<WorkflowOut> {
        const definition = await this.valid(tx, input.definition, required(ctx.scopePath), language);
        let row: DefinitionRow;
        try {
            row = await insertAudited(tx, workflowDefinitions, {
                regionId: required(ctx.regionId),
                ownerUnitId: required(ctx.unitId),
                key: input.key,
                name: input.name
            });
        } catch (error) {
            if (isUniqueViolation(error, 'workflow_definitions_key_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'A workflow with this key already exists in the region.',
                    cause: error
                });
            throw error;
        }
        const version = await this.store(tx, row, definition);
        await updateAudited(tx, workflowDefinitions, row.id, row.rowVersion, { latestVersionId: version.id });
        return this.get(tx, row.id);
    }

    /**
     * A new version of a workflow the caller's unit owns (or is above): stored once checked, numbered after the last; the
     * same content as an earlier version names that version and makes it the latest again.
     */
    async addVersion(tx: Tx, ctx: DbContext, id: string, raw: unknown, language: string): Promise<WorkflowVersionOut> {
        const current = await this.writable(tx, ctx, id);
        const definition = await this.valid(tx, raw, current.orgPath, language);
        const version = await this.store(tx, current, definition);
        if (current.latestVersionId !== version.id)
            await updateAudited(tx, workflowDefinitions, current.id, current.rowVersion, {
                latestVersionId: version.id
            });
        return versionOf(version);
    }

    /** The version holding `definition`: the existing one with its content, or a new one numbered after the last. */
    private async store(tx: Tx, owner: DefinitionRow, definition: WorkflowDefinition): Promise<VersionRow> {
        const hash = contentHash(definition);
        const [existing] = await tx
            .select()
            .from(workflowDefinitionVersions)
            .where(
                and(
                    eq(workflowDefinitionVersions.definitionId, owner.id),
                    eq(workflowDefinitionVersions.contentHash, hash)
                )
            );
        if (existing) return existing;
        const [last] = await tx
            .select({ number: max(workflowDefinitionVersions.number) })
            .from(workflowDefinitionVersions)
            .where(eq(workflowDefinitionVersions.definitionId, owner.id));
        return insertAudited(tx, workflowDefinitionVersions, {
            regionId: owner.regionId,
            ownerUnitId: owner.ownerUnitId,
            definitionId: owner.id,
            number: (last?.number ?? 0) + 1,
            contentHash: hash,
            definition
        });
    }

    async list(tx: Tx, query: z.infer<typeof workflowListQuerySchema>): Promise<WorkflowOut[]> {
        const like = query.q ? `%${escapeLike(query.q)}%` : undefined;
        const conditions = [
            query.active === undefined ? undefined : eq(workflowDefinitions.active, query.active === 'true'),
            like
                ? or(
                      ilike(workflowDefinitions.key, like),
                      sql`exists (select 1 from jsonb_each_text(${workflowDefinitions.name}) n where n.value ilike ${like})`
                  )
                : undefined
        ].filter((c) => c !== undefined);
        const rows = await tx
            .select()
            .from(workflowDefinitions)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(workflowDefinitions.updatedAt), workflowDefinitions.id)
            .limit(query.limit);
        return this.out(tx, rows);
    }

    async get(tx: Tx, id: string): Promise<WorkflowOut> {
        const [row] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
        if (!row) throw new NotFoundError();
        const [out] = await this.out(tx, [row]);
        if (!out) throw new NotFoundError();
        return out;
    }

    async versions(tx: Tx, id: string): Promise<WorkflowVersionSummary[]> {
        await this.get(tx, id);
        const rows = await tx
            .select()
            .from(workflowDefinitionVersions)
            .where(eq(workflowDefinitionVersions.definitionId, id))
            .orderBy(desc(workflowDefinitionVersions.number));
        return rows.map(summaryOf);
    }

    async version(tx: Tx, id: string, versionId: string): Promise<WorkflowVersionOut> {
        const [row] = await tx
            .select()
            .from(workflowDefinitionVersions)
            .where(and(eq(workflowDefinitionVersions.id, versionId), eq(workflowDefinitionVersions.definitionId, id)));
        if (!row) throw new NotFoundError();
        return versionOf(row);
    }

    /** Renames a workflow or switches it on or off, based on the version read (If-Match): the caller's own or below. */
    async update(
        tx: Tx,
        ctx: DbContext,
        id: string,
        expectedVersion: number,
        changes: WorkflowUpdate
    ): Promise<WorkflowOut> {
        const row = await this.writable(tx, ctx, id);
        await updateAudited(tx, workflowDefinitions, row.id, expectedVersion, changes);
        return this.get(tx, id);
    }

    /** A workflow the caller's unit owns or is above, locked: one of an office above is read-only here. */
    private async writable(tx: Tx, ctx: DbContext, id: string): Promise<DefinitionRow> {
        const [row] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
        if (!row) throw new NotFoundError();
        if (!withinScope(row.orgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detail: 'This workflow belongs to an office above yours.' });
        // locked once it is known to be the caller's: two versions stored at once are numbered one after the other
        const [locked] = await tx
            .select()
            .from(workflowDefinitions)
            .where(eq(workflowDefinitions.id, id))
            .for('update');
        if (!locked) throw new NotFoundError();
        return locked;
    }

    private async out(tx: Tx, rows: DefinitionRow[]): Promise<WorkflowOut[]> {
        const latestIds = rows.map((r) => r.latestVersionId).filter((v): v is string => Boolean(v));
        const latest = latestIds.length
            ? await tx
                  .select({ id: workflowDefinitionVersions.id, number: workflowDefinitionVersions.number })
                  .from(workflowDefinitionVersions)
                  .where(inArray(workflowDefinitionVersions.id, latestIds))
            : [];
        const numbers = new Map(latest.map((v) => [v.id, v.number]));
        const units = await unitRefs(
            tx,
            rows.map((r) => r.ownerUnitId)
        );
        return rows.map((row) => {
            const number = row.latestVersionId ? numbers.get(row.latestVersionId) : undefined;
            return {
                id: row.id,
                version: row.rowVersion,
                key: row.key,
                name: row.name,
                active: row.active,
                ownerUnit: units.get(row.ownerUnitId) ?? { id: row.ownerUnitId, code: '', name: {} },
                latestVersion: row.latestVersionId && number !== undefined ? { id: row.latestVersionId, number } : null,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString()
            };
        });
    }
}

const summaryOf = (r: VersionRow): WorkflowVersionSummary => ({
    id: r.id,
    definitionId: r.definitionId,
    number: r.number,
    contentHash: r.contentHash,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy
});

const versionOf = (r: VersionRow): WorkflowVersionOut => ({
    ...summaryOf(r),
    definition: r.definition as Record<string, unknown>
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
