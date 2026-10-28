/**
 * Form definitions, their versions and their publications (task 0.16a; form-platform.md G2, G6). A definition's working
 * copy changes freely; publishing snapshots it as an immutable version (one per content: publishing the same content
 * again reuses it) and asks a second person to approve. Until they do, people keep filling in the version published
 * before. Every write goes through the audited helpers in the caller's transaction.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, lt, max, or, sql } from 'drizzle-orm';
import { contextOfTx, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@itrms/kernel/errors';
import { unitRefs, withinScope, type UnitRef } from '@itrms/kernel/org';
import { users } from '@itrms/kernel/tables';
import { currentContext } from '@itrms/kernel/context';
import { emit } from '@itrms/kernel/outbox';
import type { z } from 'zod';

import type {
    Form,
    FormSummary,
    FormVersion,
    FormVersionSummary,
    Publication,
    PublishCheck,
    formCreateSchema,
    formListQuerySchema,
    formUpdateSchema,
    publicationListQuerySchema
} from '../contracts';
import { formDefinitions, formPublications, formVersions } from './forms.table';
import { RegistryLookups } from './lookups';
import {
    approvedVersions,
    assertLookups,
    assertReadable,
    contentHash,
    fieldsFor,
    isUniqueViolation,
    required
} from './support';
import { assertKeysStable, assertPublishable, publishCheck, publishedDocument } from './governance';
import { filterableKinds } from './view-fields';

type DefinitionRow = typeof formDefinitions.$inferSelect;
type VersionRow = typeof formVersions.$inferSelect;
type PublicationRow = typeof formPublications.$inferSelect;

const LIST_LIMIT = 100;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class FormsService {
    constructor(@Inject(RegistryLookups) private readonly lookups: RegistryLookups = new RegistryLookups()) {}

    async list(tx: Tx, query: z.infer<typeof formListQuerySchema>): Promise<FormSummary[]> {
        const conditions = [];
        if (query.active) conditions.push(eq(formDefinitions.active, query.active === 'true'));
        if (query.q) {
            const like = `%${escapeLike(query.q)}%`;
            conditions.push(
                or(
                    ilike(formDefinitions.key, like),
                    sql`exists (select 1 from jsonb_each_text(${formDefinitions.name}) n where n.value ilike ${like})`
                )
            );
        }
        const rows = await tx
            .select()
            .from(formDefinitions)
            .where(and(...conditions))
            .orderBy(desc(formDefinitions.updatedAt), desc(formDefinitions.id))
            .limit(query.limit);
        return this.summaries(tx, rows);
    }

    async get(tx: Tx, id: string): Promise<Form> {
        const row = await this.definition(tx, id);
        const [summary] = await this.summaries(tx, [row]);
        if (!summary) throw new NotFoundError();
        return { ...summary, document: row.document, documentHash: row.documentHash };
    }

    async create(tx: Tx, ctx: DbContext, input: z.infer<typeof formCreateSchema>): Promise<Form> {
        assertReadable(input.document);
        assertLookups(input.document, this.lookups);
        try {
            const row = await insertAudited(tx, formDefinitions, {
                regionId: required(ctx.regionId),
                ownerUnitId: required(ctx.unitId),
                key: input.key,
                name: input.name,
                category: input.category ?? null,
                document: input.document,
                documentHash: contentHash(input.document),
                documentUpdatedBy: ctx.userId ?? null
            });
            return this.get(tx, row.id);
        } catch (error) {
            if (isUniqueViolation(error, 'form_definitions_key_uq'))
                throw new ConflictError('duplicate_reference', {
                    detail: 'A form with this key already exists in the region.',
                    cause: error
                });
            throw error;
        }
    }

    async update(
        tx: Tx,
        ctx: DbContext,
        id: string,
        version: number,
        input: z.infer<typeof formUpdateSchema>
    ): Promise<Form> {
        const current = await this.writable(tx, ctx, id);
        if (input.document !== undefined) {
            assertReadable(input.document);
            assertLookups(input.document, this.lookups);
            // a key the published version holds stays (flagged removed when it leaves the form)
            assertKeysStable(await publishedDocument(tx, current), input.document, currentContext()?.language ?? 'am');
        }
        const hash = input.document !== undefined ? contentHash(input.document) : undefined;
        await updateAudited(tx, formDefinitions, id, version, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.document !== undefined ? { document: input.document, documentHash: hash } : {}),
            // who changed the content (saving the same content again changes nothing)
            ...(hash !== undefined && hash !== current.documentHash ? { documentUpdatedBy: ctx.userId ?? null } : {})
        });
        return this.get(tx, id);
    }

    async versions(tx: Tx, formId: string): Promise<FormVersionSummary[]> {
        const form = await this.definition(tx, formId);
        const rows = await tx
            .select({
                id: formVersions.id,
                formId: formVersions.formId,
                number: formVersions.number,
                contentHash: formVersions.contentHash,
                createdAt: formVersions.createdAt,
                createdBy: formVersions.createdBy
            })
            .from(formVersions)
            .where(eq(formVersions.formId, formId))
            .orderBy(desc(formVersions.number))
            .limit(LIST_LIMIT);
        // when each version last went live: its latest approved publication
        const live = await tx
            .select({ formVersionId: formPublications.formVersionId, at: max(formPublications.decidedAt) })
            .from(formPublications)
            .where(and(eq(formPublications.formId, formId), eq(formPublications.status, 'approved')))
            .groupBy(formPublications.formVersionId);
        const publishedAt = new Map(live.map((l) => [l.formVersionId, l.at]));
        const people = await namesOf(
            tx,
            rows.map((r) => r.createdBy)
        );
        return rows.map((v) => ({
            ...v,
            createdAt: v.createdAt.toISOString(),
            published: v.id === form.publishedVersionId,
            publishedAt: publishedAt.get(v.id)?.toISOString() ?? null,
            createdByName: v.createdBy ? (people.get(v.createdBy) ?? null) : null
        }));
    }

    /**
     * Which of `refs` (a form key and a version number, as a workflow's step forms name them) a workflow owned at
     * `ownerPath` may name: versions a second person approved (SEC-AC-6), of active forms owned at that unit or above it
     * (every unit that runs the workflow can read them). `<key>@<number>` of each one found.
     */
    async existingVersions(
        tx: Tx,
        refs: readonly { key: string; number: number }[],
        ownerPath: string
    ): Promise<Set<string>> {
        if (refs.length === 0) return new Set();
        const rows = await tx
            .select({ id: formVersions.id, key: formDefinitions.key, number: formVersions.number })
            .from(formVersions)
            .innerJoin(formDefinitions, eq(formDefinitions.id, formVersions.formId))
            .where(
                and(
                    inArray(formDefinitions.key, [...new Set(refs.map((r) => r.key))]),
                    inArray(formVersions.number, [...new Set(refs.map((r) => r.number))]),
                    eq(formDefinitions.active, true),
                    sql`${formDefinitions.orgPath} @> ${ownerPath}::ltree`
                )
            );
        const approved = await approvedVersions(
            tx,
            rows.map((r) => r.id)
        );
        return new Set(rows.filter((r) => approved.has(r.id)).map((r) => `${r.key}@${r.number}`));
    }

    /**
     * The form version a workflow step names (`<key>@<number>`), among the forms the caller can read: an approved version
     * of an active form (as `existingVersions` checked when the workflow was stored). Null when there is none.
     */
    async stepVersion(tx: Tx, key: string, number: number): Promise<{ formId: string; versionId: string } | null> {
        const [row] = await tx
            .select({ formId: formVersions.formId, versionId: formVersions.id })
            .from(formVersions)
            .innerJoin(formDefinitions, eq(formDefinitions.id, formVersions.formId))
            .where(
                and(eq(formDefinitions.key, key), eq(formVersions.number, number), eq(formDefinitions.active, true))
            );
        return row && (await approvedVersions(tx, [row.versionId])).has(row.versionId) ? row : null;
    }

    async version(tx: Tx, formId: string, versionId: string): Promise<FormVersion> {
        const [row] = await tx
            .select()
            .from(formVersions)
            .where(and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)));
        if (!row) throw new NotFoundError();
        return versionOf(row);
    }

    /** The version people fill in. */
    async published(tx: Tx, formId: string): Promise<FormVersion> {
        const form = await this.definition(tx, formId);
        if (!form.publishedVersionId)
            throw new ConflictError('not_configured', { detail: 'This form has not been published yet.' });
        return this.version(tx, formId, form.publishedVersionId);
    }

    /** Snapshot the working copy and ask for it to be published. */
    async requestPublication(tx: Tx, ctx: DbContext, formId: string, note?: string): Promise<Publication> {
        // locked: two requests for one form are made one after the other (version numbers, the open request)
        const form = await this.writable(tx, ctx, formId, { lock: true });
        if (!form.active)
            throw new ConflictError('invalid_transition', { detail: 'This form is switched off: switch it on first.' });
        const [pending] = await tx
            .select({ id: formPublications.id })
            .from(formPublications)
            .where(and(eq(formPublications.formId, formId), eq(formPublications.status, 'pending')));
        if (pending)
            throw new ConflictError('invalid_transition', {
                detail: 'A publication of this form already waits for approval.'
            });
        // a form saved under an older contract is checked again before it can go live
        assertReadable(form.document);
        assertLookups(form.document, this.lookups);
        await assertPublishable(
            tx,
            ctx.userId,
            form,
            { id: null, number: null, document: form.document },
            currentContext()?.language ?? 'am'
        );
        const version = await this.snapshot(tx, form);
        if (version.id === form.publishedVersionId)
            throw new ConflictError('invalid_transition', { detail: 'This version of the form is already published.' });
        try {
            const row = await insertAudited(tx, formPublications, {
                regionId: form.regionId,
                unitId: form.ownerUnitId,
                formId,
                formVersionId: version.id,
                contentBy: form.documentUpdatedBy,
                note: note ?? null
            });
            return (await this.publicationsOf(tx, [row]))[0] as Publication;
        } catch (error) {
            if (isUniqueViolation(error, 'form_publications_pending_uq'))
                throw new ConflictError('invalid_transition', {
                    detail: 'A publication of this form already waits for approval.',
                    cause: error
                });
            throw error;
        }
    }

    /**
     * The publications of the caller's view, newest first, a page at a time (task 0.20d): all of them, the caller's own
     * requests, or those they may decide (pending, neither asked for nor authored by them, and they hold `form:approve`:
     * the same rule as `canDecide`). Ids are UUIDv7, so the newest first is by id and a page starts after `before`.
     */
    async publications(
        tx: Tx,
        query: z.infer<typeof publicationListQuerySchema>
    ): Promise<{ items: Publication[]; next: string | null }> {
        const me = contextOfTx(tx).userId ?? null;
        const mayApprove = currentContext()?.principal?.permissions.has('form:approve') ?? false;
        if (query.scope === 'decidable' && (!mayApprove || !me || query.status !== 'pending'))
            return { items: [], next: null };
        const rows = await tx
            .select()
            .from(formPublications)
            .where(
                and(
                    eq(formPublications.status, query.status),
                    query.formId ? eq(formPublications.formId, query.formId) : undefined,
                    query.scope === 'mine' ? eq(formPublications.createdBy, me ?? '') : undefined,
                    query.scope === 'decidable' && me
                        ? sql`${formPublications.createdBy} is distinct from ${me}::uuid
                              and ${formPublications.contentBy} is distinct from ${me}::uuid`
                        : undefined,
                    query.before ? lt(formPublications.id, query.before) : undefined
                )
            )
            .orderBy(desc(formPublications.id))
            .limit(Math.min(query.limit, LIST_LIMIT) + 1);
        const page = rows.slice(0, query.limit);
        return {
            items: await this.publicationsOf(tx, page),
            next: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null
        };
    }

    /** How many pending publications the caller may decide (`canDecide`'s rule), up to the list's limit. */
    async decidableCount(tx: Tx): Promise<number> {
        const me = contextOfTx(tx).userId;
        if (!me || !(currentContext()?.principal?.permissions.has('form:approve') ?? false)) return 0;
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(formPublications)
            .where(
                and(
                    eq(formPublications.status, 'pending'),
                    sql`${formPublications.createdBy} is distinct from ${me}::uuid
                        and ${formPublications.contentBy} is distinct from ${me}::uuid`
                )
            );
        return row?.n ?? 0;
    }

    /** What publishing the working copy would change and whom it affects (the builder asks before it requests). */
    async publishCheck(tx: Tx, ctx: DbContext, formId: string): Promise<PublishCheck> {
        const form = await this.definition(tx, formId);
        // a snapshot of the same content is the version the request would reuse
        const [same] = await tx
            .select({ id: formVersions.id, number: formVersions.number })
            .from(formVersions)
            .where(and(eq(formVersions.formId, formId), eq(formVersions.contentHash, form.documentHash)));
        return publishCheck(
            tx,
            ctx.userId,
            form,
            { id: same?.id ?? null, number: same?.number ?? null, document: form.document },
            currentContext()?.language ?? 'am'
        );
    }

    /** What a publication request changes against the published version (the approver reads it before deciding). */
    async review(tx: Tx, ctx: DbContext, id: string): Promise<PublishCheck> {
        const [row] = await tx.select().from(formPublications).where(eq(formPublications.id, id));
        if (!row) throw new NotFoundError();
        const form = await this.definition(tx, row.formId);
        const candidate = await this.version(tx, row.formId, row.formVersionId);
        return publishCheck(
            tx,
            ctx.userId,
            form,
            { id: candidate.id, number: candidate.number, document: candidate.document },
            currentContext()?.language ?? 'am'
        );
    }

    async approve(tx: Tx, ctx: DbContext, id: string, version: number, note?: string): Promise<Publication> {
        const publication = await this.pending(tx, ctx, id);
        const form = await this.writable(tx, ctx, publication.formId, { lock: true });
        if (!form.active)
            throw new ConflictError('invalid_transition', {
                detail: 'This form was switched off: reject the request.'
            });
        // checked again: the published version may have changed since the request was made
        const candidate = await this.version(tx, form.id, publication.formVersionId);
        await assertPublishable(
            tx,
            ctx.userId,
            form,
            { id: candidate.id, number: candidate.number, document: candidate.document },
            currentContext()?.language ?? 'am'
        );
        const previousVersionId = form.publishedVersionId;
        // a key stays indexed only if the new version marks it filterable with the same kind as the previous one: its
        // rows are then complete and of the right type. The others go back to the answers at once; the worker fills
        // the newly marked ones (form.published.v1)
        const kindsOf = async (id: string | null) => {
            if (!id) return new Map<string, string>();
            const [v] = await tx
                .select({ document: formVersions.document })
                .from(formVersions)
                .where(eq(formVersions.id, id));
            return filterableKinds(fieldsFor(v?.document, [])) as Map<string, string>;
        };
        const before = await kindsOf(previousVersionId);
        const after = await kindsOf(publication.formVersionId);
        await updateAudited(tx, formDefinitions, form.id, form.rowVersion, {
            publishedVersionId: publication.formVersionId,
            publishedAt: new Date(),
            indexedKeys: form.indexedKeys.filter((k) => after.has(k) && after.get(k) === before.get(k))
        });
        const decided = await updateAudited(tx, formPublications, id, version, {
            status: 'approved',
            decidedBy: ctx.userId ?? null,
            decidedAt: new Date(),
            decisionNote: note ?? null
        });
        await emit(
            tx,
            'form.published.v1',
            { formId: form.id, formVersionId: publication.formVersionId, previousVersionId, publicationId: id },
            { unitId: form.ownerUnitId, regionId: form.regionId }
        );
        return (await this.publicationsOf(tx, [decided]))[0] as Publication;
    }

    async reject(tx: Tx, ctx: DbContext, id: string, version: number, note?: string): Promise<Publication> {
        await this.pending(tx, ctx, id);
        const decided = await updateAudited(tx, formPublications, id, version, {
            status: 'rejected',
            decidedBy: ctx.userId ?? null,
            decidedAt: new Date(),
            decisionNote: note ?? null
        });
        return (await this.publicationsOf(tx, [decided]))[0] as Publication;
    }

    /** The person who asked takes the request back (deciding stays with another person). */
    async withdraw(tx: Tx, ctx: DbContext, id: string, version: number): Promise<Publication> {
        const [row] = await tx.select().from(formPublications).where(eq(formPublications.id, id));
        if (!row) throw new NotFoundError();
        if (row.status !== 'pending')
            throw new ConflictError('invalid_transition', { detail: 'This request was already decided.' });
        if (row.createdBy !== ctx.userId)
            throw new ForbiddenError({ detail: 'Only the person who asked can withdraw the request.' });
        const withdrawn = await updateAudited(tx, formPublications, id, version, {
            status: 'withdrawn',
            decidedBy: ctx.userId ?? null,
            decidedAt: new Date()
        });
        return (await this.publicationsOf(tx, [withdrawn]))[0] as Publication;
    }

    // ---- helpers ----

    /** A form the caller may read (its own, its subtree's, or an ancestor's). */
    async definition(tx: Tx, id: string): Promise<DefinitionRow> {
        const [row] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, id));
        if (!row) throw new NotFoundError();
        return row;
    }

    /** A form the caller's unit owns or is above: one of an office above is read-only here. */
    private async writable(
        tx: Tx,
        ctx: DbContext,
        id: string,
        options: { lock?: boolean } = {}
    ): Promise<DefinitionRow> {
        const row = await this.definition(tx, id);
        if (!withinScope(row.orgPath, ctx.scopePath ?? ''))
            throw new ForbiddenError({ detail: 'This form belongs to an office above yours.' });
        if (!options.lock) return row;
        // locked only once it is known to be the caller's (a lock also applies the UPDATE policy)
        const [locked] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, id)).for('update');
        if (!locked) throw new NotFoundError();
        return locked;
    }

    /** The version holding the working copy: the existing one with its content, or a new one numbered after the last. */
    private async snapshot(tx: Tx, form: DefinitionRow): Promise<VersionRow> {
        const [existing] = await tx
            .select()
            .from(formVersions)
            .where(and(eq(formVersions.formId, form.id), eq(formVersions.contentHash, form.documentHash)));
        if (existing) return existing;
        const [last] = await tx
            .select({ number: max(formVersions.number) })
            .from(formVersions)
            .where(eq(formVersions.formId, form.id));
        return insertAudited(tx, formVersions, {
            regionId: form.regionId,
            ownerUnitId: form.ownerUnitId,
            formId: form.id,
            number: (last?.number ?? 0) + 1,
            contentHash: form.documentHash,
            document: form.document
        });
    }

    /** A request waiting for a decision, decided by someone other than who asked and who wrote the content (SEC-AC-6). */
    private async pending(tx: Tx, ctx: DbContext, id: string): Promise<PublicationRow> {
        const [row] = await tx.select().from(formPublications).where(eq(formPublications.id, id));
        if (!row) throw new NotFoundError();
        if (row.status !== 'pending')
            throw new ConflictError('invalid_transition', { detail: 'This request was already decided.' });
        if (row.createdBy && row.createdBy === ctx.userId)
            throw new ForbiddenError({
                detail: 'Who asks for a publication cannot approve it: another person decides.',
                audit: { reason: 'separation_of_duties', publicationId: id }
            });
        if (row.contentBy && row.contentBy === ctx.userId)
            throw new ForbiddenError({
                detail: 'Who changed the form cannot approve its publication: another person decides.',
                audit: { reason: 'separation_of_duties', publicationId: id }
            });
        return row;
    }

    private async summaries(tx: Tx, rows: readonly DefinitionRow[]): Promise<FormSummary[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const published = rows.map((r) => r.publishedVersionId).filter((v): v is string => Boolean(v));
        const versions = published.length
            ? await tx
                  .select({ id: formVersions.id, number: formVersions.number, contentHash: formVersions.contentHash })
                  .from(formVersions)
                  .where(inArray(formVersions.id, published))
            : [];
        const byId = new Map(versions.map((v) => [v.id, v]));
        const pending = new Set(
            (
                await tx
                    .select({ formId: formPublications.formId })
                    .from(formPublications)
                    .where(and(inArray(formPublications.formId, ids), eq(formPublications.status, 'pending')))
            ).map((p) => p.formId)
        );
        const units = await unitRefs(
            tx,
            rows.map((r) => r.ownerUnitId)
        );
        return rows.map((row) => {
            const live = row.publishedVersionId ? byId.get(row.publishedVersionId) : undefined;
            return {
                id: row.id,
                version: row.rowVersion,
                key: row.key,
                name: row.name,
                category: row.category,
                active: row.active,
                status: pending.has(row.id)
                    ? 'pending'
                    : live && live.contentHash === row.documentHash
                      ? 'published'
                      : 'draft',
                ownerUnit: unitOf(units, row.ownerUnitId),
                publishedVersion:
                    live && row.publishedAt
                        ? { id: live.id, number: live.number, publishedAt: row.publishedAt.toISOString() }
                        : null,
                updatedAt: row.updatedAt.toISOString()
            };
        });
    }

    private async publicationsOf(tx: Tx, rows: readonly PublicationRow[]): Promise<Publication[]> {
        if (rows.length === 0) return [];
        const forms = await tx
            .select({ id: formDefinitions.id, name: formDefinitions.name })
            .from(formDefinitions)
            .where(inArray(formDefinitions.id, [...new Set(rows.map((r) => r.formId))]));
        const versions = await tx
            .select({ id: formVersions.id, number: formVersions.number })
            .from(formVersions)
            .where(inArray(formVersions.id, [...new Set(rows.map((r) => r.formVersionId))]));
        const names = new Map(forms.map((f) => [f.id, f.name]));
        const numbers = new Map(versions.map((v) => [v.id, v.number]));
        const people = await namesOf(
            tx,
            rows.flatMap((r) => [r.createdBy, r.decidedBy])
        );
        const me = contextOfTx(tx).userId;
        // what the caller's roles let them do with it (the routes enforce it again; this only tells the screens)
        const granted = currentContext()?.principal?.permissions;
        const may = (permission: string) => granted?.has(permission) ?? false;
        return rows.map((r) => ({
            id: r.id,
            version: r.rowVersion,
            formId: r.formId,
            formName: names.get(r.formId) ?? {},
            formVersion: { id: r.formVersionId, number: numbers.get(r.formVersionId) ?? 0 },
            status: r.status,
            note: r.note,
            requestedBy: r.createdBy,
            requestedByName: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
            requestedAt: r.createdAt.toISOString(),
            decidedBy: r.decidedBy,
            decidedByName: r.decidedBy ? (people.get(r.decidedBy) ?? null) : null,
            canDecide: r.status === 'pending' && r.createdBy !== me && r.contentBy !== me && may('form:approve'),
            canWithdraw: r.status === 'pending' && r.createdBy === me && may('form:publish'),
            decidedAt: r.decidedAt?.toISOString() ?? null,
            decisionNote: r.decisionNote
        }));
    }
}

export const versionOf = (row: VersionRow): FormVersion => ({
    id: row.id,
    formId: row.formId,
    number: row.number,
    contentHash: row.contentHash,
    document: row.document,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy
});

export function unitOf(units: ReadonlyMap<string, UnitRef>, id: string): UnitRef {
    return units.get(id) ?? { id, code: '', name: {} };
}

/** Staff names for what a form shows (users are a regional record). */
export async function namesOf(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await tx
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, wanted));
    return new Map(rows.map((r) => [r.id, r.name]));
}
