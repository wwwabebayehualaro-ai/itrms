/**
 * Form overlays (task 0.21f, form-platform.md §4): a unit's additions to a bureau form, written by the unit itself and
 * published through a second person (SEC-AC-6, form_publications), and composed onto the bureau's version its new cases
 * are filed on. Plain functions over the caller's transaction: the forms slice writes and decides overlays, the services
 * slice composes the form a request is filed on.
 *
 * Which overlays apply at a unit: the published ones of the units on its chain below the form's owner, root side first (a
 * zone's, then a woreda's). The composed form is stored as a version of the bureau's form, at the filing unit, naming its
 * base and the overlay versions applied (G2: a case's form never changes; G3: what was filed stays readable). Composing
 * never fails: what no longer fits is passed over and reported (in the overlay, and in the bureau's publish impact).
 */
import { and, asc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { getUnit, unitRefs, withinScope, type OrgUnit, type UnitRef } from '@itrms/kernel/org';
import { isUniqueViolation } from './support';
import {
    applyOverlays,
    checkOverlay,
    runTestCases,
    type OverlayConflict,
    type OverlayLayer
} from '@itrms/form-engine/core';
import { formOverlaySchema, type FormOverlay, type OverlayConflictCode } from '@itrms/schemas';

import type { FormOverlayOut, ImpactOverlay, OverlayConflictOut } from '../contracts';
import { formDefinitions, formOverlays, formOverlayVersions, formPublications, formVersions } from './forms.table';
import am from '../messages/am.json';
import en from '../messages/en.json';

type DefinitionRow = typeof formDefinitions.$inferSelect;
type OverlayRow = typeof formOverlays.$inferSelect;
export type PublicationRow = typeof formPublications.$inferSelect;

/** The first key of the composed-version locks (no other advisory lock shares it). */
const COMPOSE_LOCK = 0x0f21;

const EMPTY: FormOverlay = { add: [], options: [] };

const message = (code: OverlayConflictCode, language: string): string => {
    const key = `forms.overlay.conflict.${code}` as keyof typeof en;
    return (language === 'en' ? en : am)[key] ?? key;
};

/** A form the bureau owns (at the region's root): only those take overlays; a unit's own form it changes itself. */
const isBureauForm = (form: Pick<DefinitionRow, 'orgPath'>) => !form.orgPath.includes('.');

/** The published overlays of a form on the chain of the unit at `unitPath` (below the form's owner), root side first. */
export async function chainOverlays(
    tx: Tx,
    form: Pick<DefinitionRow, 'id' | 'ownerUnitId'>,
    unitPath: string
): Promise<(OverlayLayer & { number: number; path: string })[]> {
    const rows = await tx
        .select({
            unitId: formOverlays.ownerUnitId,
            path: formOverlays.orgPath,
            versionId: formOverlayVersions.id,
            number: formOverlayVersions.number,
            patch: formOverlayVersions.patch
        })
        .from(formOverlays)
        .innerJoin(formOverlayVersions, eq(formOverlayVersions.id, formOverlays.publishedVersionId))
        .where(
            and(
                eq(formOverlays.formId, form.id),
                ne(formOverlays.ownerUnitId, form.ownerUnitId),
                sql`${formOverlays.orgPath} @> ${unitPath}::ltree`
            )
        )
        .orderBy(sql`nlevel(${formOverlays.orgPath})`);
    return rows.map((r) => ({ ...r, patch: formOverlaySchema.parse(r.patch) }));
}

/** The form a unit's new cases fill in, composed from a bureau version and the unit's chain's overlays (no write). */
export async function composedFor(
    tx: Tx,
    form: Pick<DefinitionRow, 'id' | 'ownerUnitId'>,
    base: { id: string; document: unknown },
    unitPath: string,
    locks: ReadonlySet<string>,
    /** whether the service's policy lets the overlay of the unit at this path apply (none: every one does) */
    allowed: (overlayUnitPath: string) => boolean = () => true
): Promise<{ document: unknown; conflicts: OverlayConflict[]; layers: (OverlayLayer & { number: number })[] }> {
    const layers = (await chainOverlays(tx, form, unitPath)).filter((l) => allowed(l.path));
    if (layers.length === 0) return { document: base.document, conflicts: [], layers };
    const { document, conflicts, applied } = applyOverlays(base.document, layers, { locks });
    return { document, conflicts, layers: layers.filter((l) => applied.includes(l.versionId)) };
}

/**
 * The stored version of a composed form (made once, then reused): a version of the bureau's form at the filing unit,
 * naming its base and the overlay versions applied. The base itself when no overlay applies.
 */
export async function materialize(
    tx: Tx,
    form: Pick<DefinitionRow, 'id'>,
    base: { id: string; number: number },
    unit: Pick<OrgUnit, 'id' | 'regionId'>,
    composed: { document: unknown; layers: readonly OverlayLayer[] }
): Promise<string> {
    if (composed.layers.length === 0) return base.id;
    const overlayVersionIds = composed.layers.map((l) => l.versionId);
    const hash = contentHash({ document: composed.document, overlays: overlayVersionIds });
    // two requests filed at once make one row: the second waits, then finds it
    await tx.execute(sql`select pg_advisory_xact_lock(${COMPOSE_LOCK}, hashtext(${`${unit.id}:${base.id}`}))`);
    const [existing] = await tx
        .select({ id: formVersions.id })
        .from(formVersions)
        .where(
            and(
                eq(formVersions.ownerUnitId, unit.id),
                eq(formVersions.baseVersionId, base.id),
                eq(formVersions.contentHash, hash)
            )
        );
    if (existing) return existing.id;
    const row = await insertAudited(tx, formVersions, {
        regionId: unit.regionId,
        ownerUnitId: unit.id,
        formId: form.id,
        number: base.number,
        contentHash: hash,
        document: composed.document,
        baseVersionId: base.id,
        overlayVersionIds
    });
    return row.id;
}

/** Conflicts as the API answers them: each with its unit and its message in the reader's language. */
async function conflictsOut(
    tx: Tx,
    conflicts: readonly {
        unitId: string;
        versionId: string | null;
        op: OverlayConflict['op'];
        key: string | null;
        problem: OverlayConflictCode;
    }[],
    language: string
): Promise<OverlayConflictOut[]> {
    const units = await unitRefs(
        tx,
        conflicts.map((c) => c.unitId)
    );
    return conflicts.map((c) => ({
        unit: units.get(c.unitId) ?? { id: c.unitId, code: '', name: {} },
        overlayVersionId: c.versionId,
        op: c.op,
        key: c.key,
        problem: c.problem,
        message: message(c.problem, language)
    }));
}

async function overlayRow(tx: Tx, formId: string, unitId: string, lock = false): Promise<OverlayRow | undefined> {
    const query = tx
        .select()
        .from(formOverlays)
        .where(and(eq(formOverlays.formId, formId), eq(formOverlays.ownerUnitId, unitId)));
    const [row] = lock ? await query.for('update') : await query;
    return row;
}

/** The bureau's published version a unit overlays, with its ancestors' overlays already composed onto it. */
async function overlayBase(tx: Tx, form: DefinitionRow, unit: OrgUnit, locks: ReadonlySet<string>) {
    if (!form.publishedVersionId)
        throw new ConflictError('not_configured', { detail: 'The form has not been published yet.' });
    const [base] = await tx
        .select({ id: formVersions.id, number: formVersions.number, document: formVersions.document })
        .from(formVersions)
        .where(eq(formVersions.id, form.publishedVersionId));
    if (!base) throw new NotFoundError();
    // the overlays of the units above this one (the unit's own comes last)
    const parentPath = unit.path.includes('.') ? unit.path.slice(0, unit.path.lastIndexOf('.')) : unit.path;
    const above = (await chainOverlays(tx, form, parentPath)).filter((l) => l.unitId !== unit.id);
    const { document } = applyOverlays(base.document, above, { locks });
    return { base, document };
}

/** A unit may overlay a bureau form, below the bureau, within the caller's scope. */
function assertOverlayable(form: DefinitionRow, unit: OrgUnit, ctx: DbContext): void {
    if (!isBureauForm(form))
        throw new ValidationError('validation_failed', {
            detail: 'Only a bureau form takes overlays: change your own form itself.',
            errors: [{ path: 'formId', code: 'not_regional', message: 'only a bureau form takes overlays' }]
        });
    if (unit.id === form.ownerUnitId)
        throw new ValidationError('validation_failed', {
            detail: 'The bureau changes its form itself, not through an overlay.',
            errors: [{ path: 'unitId', code: 'own_form', message: 'the bureau changes its form itself' }]
        });
    if (!withinScope(unit.path, ctx.scopePath ?? '')) throw new ForbiddenError({ detail: 'This office is not yours.' });
}

/** A unit's overlay as it is read: its working copy, where it stands, and what of it does not fit the form now. */
export async function readOverlay(
    tx: Tx,
    form: DefinitionRow,
    unitId: string,
    locks: ReadonlySet<string>,
    language: string
): Promise<FormOverlayOut> {
    const unit = await getUnit(tx, unitId);
    const row = await overlayRow(tx, form.id, unitId);
    const patch = row ? formOverlaySchema.parse(row.patch) : EMPTY;
    const [published] = row?.publishedVersionId
        ? await tx
              .select({
                  id: formOverlayVersions.id,
                  number: formOverlayVersions.number,
                  hash: formOverlayVersions.contentHash
              })
              .from(formOverlayVersions)
              .where(eq(formOverlayVersions.id, row.publishedVersionId))
        : [];
    const [pending] = row
        ? await tx
              .select({ id: formPublications.id })
              .from(formPublications)
              .where(and(eq(formPublications.overlayId, row.id), eq(formPublications.status, 'pending')))
        : [];
    const problems = form.publishedVersionId
        ? checkOverlay((await overlayBase(tx, form, unit, locks)).document, patch, { locks })
        : [];
    const units = await unitRefs(tx, [unitId]);
    return {
        id: row?.id ?? null,
        version: row?.rowVersion ?? null,
        formId: form.id,
        unit: units.get(unitId) as UnitRef,
        patch,
        status: !row ? 'none' : pending ? 'pending' : published?.hash === row.patchHash ? 'published' : 'draft',
        publishedVersion: published ? { id: published.id, number: published.number } : null,
        conflicts: await conflictsOut(
            tx,
            problems.map((p) => ({ unitId, versionId: null, ...p })),
            language
        )
    };
}

/** The unit writes its overlay's working copy (If-Match: its version; none for the first). */
export async function saveOverlay(
    tx: Tx,
    ctx: DbContext,
    form: DefinitionRow,
    unitId: string,
    patch: FormOverlay,
    expected: number | null
): Promise<void> {
    const unit = await getUnit(tx, unitId);
    assertOverlayable(form, unit, ctx);
    const row = await overlayRow(tx, form.id, unitId);
    const values = { patch, patchHash: contentHash(patch), patchUpdatedBy: ctx.userId ?? null };
    if (!row) {
        try {
            await insertAudited(tx, formOverlays, {
                regionId: unit.regionId,
                ownerUnitId: unit.id,
                formId: form.id,
                ...values
            });
        } catch (error) {
            if (isUniqueViolation(error, 'form_overlays_unit_uq'))
                throw new ConflictError('stale_version', {
                    detail: 'Someone else wrote this overlay meanwhile: read it again.',
                    cause: error
                });
            throw error;
        }
        return;
    }
    if (expected === null)
        throw new ConflictError('stale_version', { detail: 'Send the overlay version you changed (If-Match).' });
    await updateAudited(tx, formOverlays, row.id, expected, values);
}

/**
 * Every check an overlay's publication passes (asked for, and again when it is approved): the overlay itself on the
 * form as the units above left it, and the composed form's soundness and the bureau's test cases. 422 with every problem.
 */
async function assertPublishableOverlay(
    tx: Tx,
    form: DefinitionRow,
    unit: OrgUnit,
    patch: FormOverlay,
    versionId: string,
    locks: ReadonlySet<string>,
    language: string
): Promise<{ id: string; number: number }> {
    const { base, document } = await overlayBase(tx, form, unit, locks);
    const problems = checkOverlay(document, patch, { locks });
    const composed = problems.length
        ? null
        : applyOverlays(document, [{ unitId: unit.id, versionId, patch }], { locks });
    const unsound = composed?.conflicts.some((c) => c.problem === 'invalid') ?? false;
    const failing = composed && !unsound ? runTestCases(composed.document).filter((t) => !t.passed) : [];
    if (problems.length === 0 && !unsound && failing.length === 0) return { id: base.id, number: base.number };
    throw new ValidationError('validation_failed', {
        detail: 'The overlay cannot be published: fix what is listed.',
        errors: [
            ...problems.map((p) => ({
                path: `patch.${p.op}`,
                code: `overlay_${p.problem}`,
                message: `${p.key}: ${message(p.problem, language)}`
            })),
            ...(unsound ? [{ path: 'patch', code: 'overlay_invalid', message: message('invalid', language) }] : []),
            ...failing.map((t) => ({
                path: 'patch',
                code: 'test_case',
                message: `${t.name}: ${(language === 'en' ? en : am)['forms.overlay.testCaseFails']}`
            }))
        ]
    });
}

/** Snapshot the unit's working copy and ask a second person to publish it (as a form's publication). */
export async function requestOverlayPublication(
    tx: Tx,
    ctx: DbContext,
    form: DefinitionRow,
    unitId: string,
    locks: ReadonlySet<string>,
    language: string,
    note?: string
): Promise<PublicationRow> {
    const unit = await getUnit(tx, unitId);
    assertOverlayable(form, unit, ctx);
    const row = await overlayRow(tx, form.id, unitId, true);
    if (!row) throw new NotFoundError();
    const [pending] = await tx
        .select({ id: formPublications.id })
        .from(formPublications)
        .where(and(eq(formPublications.overlayId, row.id), eq(formPublications.status, 'pending')));
    if (pending)
        throw new ConflictError('invalid_transition', {
            detail: 'A publication of this overlay already waits for approval.'
        });
    const patch = formOverlaySchema.parse(row.patch);
    // the version holding the working copy: the one with its content, or a new one numbered after the last
    const [existing] = await tx
        .select()
        .from(formOverlayVersions)
        .where(and(eq(formOverlayVersions.overlayId, row.id), eq(formOverlayVersions.contentHash, row.patchHash)));
    if (existing && existing.id === row.publishedVersionId)
        throw new ConflictError('invalid_transition', { detail: 'This version of the overlay is already published.' });
    const base = await assertPublishableOverlay(tx, form, unit, patch, existing?.id ?? row.id, locks, language);
    const version =
        existing ??
        (await (async () => {
            const [last] = await tx
                .select({ number: max(formOverlayVersions.number) })
                .from(formOverlayVersions)
                .where(eq(formOverlayVersions.overlayId, row.id));
            return insertAudited(tx, formOverlayVersions, {
                regionId: row.regionId,
                ownerUnitId: row.ownerUnitId,
                overlayId: row.id,
                formId: form.id,
                number: (last?.number ?? 0) + 1,
                contentHash: row.patchHash,
                patch
            });
        })());
    return insertAudited(tx, formPublications, {
        regionId: row.regionId,
        unitId: row.ownerUnitId,
        formId: form.id,
        formVersionId: base.id,
        overlayId: row.id,
        overlayVersionId: version.id,
        contentBy: row.patchUpdatedBy,
        note: note ?? null
    });
}

/** A second person approves an overlay's publication: checked again on the form as it is now, then in effect. */
export async function approveOverlayPublication(
    tx: Tx,
    ctx: DbContext,
    publication: PublicationRow,
    version: number,
    locks: ReadonlySet<string>,
    language: string,
    note?: string
): Promise<PublicationRow> {
    if (!publication.overlayId || !publication.overlayVersionId) throw new NotFoundError();
    const [overlay] = await tx
        .select()
        .from(formOverlays)
        .where(eq(formOverlays.id, publication.overlayId))
        .for('update');
    const [asked] = await tx
        .select()
        .from(formOverlayVersions)
        .where(eq(formOverlayVersions.id, publication.overlayVersionId));
    if (!overlay || !asked) throw new NotFoundError();
    const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, overlay.formId));
    if (!form) throw new NotFoundError();
    if (!withinScope(overlay.orgPath, ctx.scopePath ?? '') && !withinScope(ctx.scopePath ?? '', overlay.orgPath))
        throw new NotFoundError();
    await assertPublishableOverlay(
        tx,
        form,
        await getUnit(tx, overlay.ownerUnitId),
        formOverlaySchema.parse(asked.patch),
        asked.id,
        locks,
        language
    );
    await updateAudited(tx, formOverlays, overlay.id, overlay.rowVersion, {
        publishedVersionId: asked.id,
        publishedAt: new Date()
    });
    return updateAudited(tx, formPublications, publication.id, version, {
        status: 'approved',
        decidedBy: ctx.userId ?? null,
        decidedAt: new Date(),
        decisionNote: note ?? null
    });
}

/** The form an overlay's publication would give its unit's new cases (the approver reviews it against the bureau's). */
export async function overlayCandidate(
    tx: Tx,
    publication: PublicationRow,
    locks: ReadonlySet<string>
): Promise<{
    document: unknown;
    base: { id: string; number: number; document: unknown };
    problems: ReturnType<typeof checkOverlay>;
}> {
    if (!publication.overlayVersionId) throw new NotFoundError();
    const [asked] = await tx
        .select()
        .from(formOverlayVersions)
        .where(eq(formOverlayVersions.id, publication.overlayVersionId));
    const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, publication.formId));
    if (!asked || !form) throw new NotFoundError();
    const unit = await getUnit(tx, asked.ownerUnitId);
    const { base, document } = await overlayBase(tx, form, unit, locks);
    const patch = formOverlaySchema.parse(asked.patch);
    return {
        document: applyOverlays(document, [{ unitId: unit.id, versionId: asked.id, patch }], { locks }).document,
        base: { id: base.id, number: base.number, document },
        problems: checkOverlay(document, patch, { locks })
    };
}

/**
 * The units' overlays a candidate version of a bureau form would re-apply, and what of each no longer fits (the
 * bureau's publish impact): each composed onto the candidate with the overlays above it, as its new cases would be.
 */
export async function overlayImpact(
    tx: Tx,
    form: Pick<DefinitionRow, 'id' | 'ownerUnitId'>,
    candidate: unknown,
    locks: ReadonlySet<string>,
    language: string
): Promise<ImpactOverlay[]> {
    const rows = await tx
        .select({
            unitId: formOverlays.ownerUnitId,
            path: formOverlays.orgPath,
            versionId: formOverlayVersions.id,
            number: formOverlayVersions.number,
            patch: formOverlayVersions.patch
        })
        .from(formOverlays)
        .innerJoin(formOverlayVersions, eq(formOverlayVersions.id, formOverlays.publishedVersionId))
        .where(and(eq(formOverlays.formId, form.id), ne(formOverlays.ownerUnitId, form.ownerUnitId)))
        .orderBy(sql`nlevel(${formOverlays.orgPath})`, asc(formOverlays.id))
        .limit(500);
    const out: ImpactOverlay[] = [];
    const units = await unitRefs(
        tx,
        rows.map((r) => r.unitId)
    );
    for (const row of rows) {
        const layers = rows
            .filter((r) => row.path === r.path || row.path.startsWith(`${r.path}.`))
            .map((r) => ({ unitId: r.unitId, versionId: r.versionId, patch: formOverlaySchema.parse(r.patch) }));
        const { conflicts } = applyOverlays(candidate, layers, { locks });
        out.push({
            unit: units.get(row.unitId) ?? { id: row.unitId, code: '', name: {} },
            overlayVersion: { id: row.versionId, number: row.number },
            conflicts: await conflictsOut(
                tx,
                conflicts.filter((c) => c.unitId === row.unitId),
                language
            )
        });
    }
    return out;
}

/** An overlay's publication as the publications list shows it: whose, and which version. */
export async function overlayRefs(
    tx: Tx,
    rows: readonly PublicationRow[]
): Promise<Map<string, { id: string; unit: UnitRef; number: number }>> {
    const ids = rows.flatMap((r) => (r.overlayVersionId ? [r.overlayVersionId] : []));
    if (ids.length === 0) return new Map();
    const versions = await tx
        .select({
            id: formOverlayVersions.id,
            overlayId: formOverlayVersions.overlayId,
            unitId: formOverlayVersions.ownerUnitId,
            number: formOverlayVersions.number
        })
        .from(formOverlayVersions)
        .where(inArray(formOverlayVersions.id, ids));
    const units = await unitRefs(
        tx,
        versions.map((v) => v.unitId)
    );
    return new Map(
        versions.map((v) => [
            v.id,
            { id: v.overlayId, unit: units.get(v.unitId) ?? { id: v.unitId, code: '', name: {} }, number: v.number }
        ])
    );
}

/** A bureau form's own versions, never the composed ones of units' cases. */
export const notComposed = () => isNull(formVersions.baseVersionId);
