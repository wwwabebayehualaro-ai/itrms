/**
 * A block's impact (task 1.13d): the forms that hold a copy of it, in their working copy or their published version, with the
 * versions they hold. A new version of a block changes none of them: each takes it when its author updates the copy. The caller
 * sees the forms its scope reads (a bureau's block: every form of the region).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { unitRefs } from '@itrms/kernel/org';
import { blockUses } from '@itrms/form-engine/core';

import type { ImpactBlockForm } from '../contracts';
import { formDefinitions, formVersions } from './forms.table';

/** A document's fields hold a section copied from this block (the JSON containment the impact query filters with). */
const holdsBlock = (column: unknown, key: string) =>
    sql`(${column} -> 'fields') @> ${JSON.stringify([{ props: { block: { key } } }])}::jsonb`;

export async function blockImpact(
    tx: Tx,
    blockKey: string,
    candidateNumber: number | null
): Promise<ImpactBlockForm[]> {
    const working = await tx
        .select({
            id: formDefinitions.id,
            key: formDefinitions.key,
            name: formDefinitions.name,
            ownerUnitId: formDefinitions.ownerUnitId,
            document: formDefinitions.document
        })
        .from(formDefinitions)
        .where(and(eq(formDefinitions.kind, 'form'), holdsBlock(formDefinitions.document, blockKey)));
    const published = await tx
        .select({
            id: formDefinitions.id,
            key: formDefinitions.key,
            name: formDefinitions.name,
            ownerUnitId: formDefinitions.ownerUnitId,
            document: formVersions.document
        })
        .from(formDefinitions)
        .innerJoin(formVersions, eq(formVersions.id, formDefinitions.publishedVersionId))
        .where(and(eq(formDefinitions.kind, 'form'), holdsBlock(formVersions.document, blockKey)));
    const forms = new Map<
        string,
        { key: string; name: Record<string, string>; ownerUnitId: string; workingCopy: number[]; published: number[] }
    >();
    const entry = (r: (typeof working)[number]) => {
        const known = forms.get(r.id);
        if (known) return known;
        const made = {
            key: r.key,
            name: r.name,
            ownerUnitId: r.ownerUnitId,
            workingCopy: [] as number[],
            published: [] as number[]
        };
        forms.set(r.id, made);
        return made;
    };
    for (const r of working) entry(r).workingCopy = blockUses(r.document, blockKey);
    for (const r of published) entry(r).published = blockUses(r.document, blockKey);
    if (forms.size === 0) return [];
    const units = await unitRefs(tx, [...new Set([...forms.values()].map((f) => f.ownerUnitId))]);
    // a new snapshot is newer than every version a form can hold
    const newest = candidateNumber ?? Number.POSITIVE_INFINITY;
    return [...forms.entries()]
        .map(([id, f]) => ({
            id,
            key: f.key,
            name: f.name,
            ownerUnit: units.get(f.ownerUnitId) ?? { id: f.ownerUnitId, code: '', name: {} },
            workingCopy: f.workingCopy,
            published: f.published,
            behind: [...f.workingCopy, ...f.published].some((v) => v < newest)
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Whether these form ids include a block (a service or a step never takes one). */
export async function anyBlock(tx: Tx, formIds: readonly string[]): Promise<boolean> {
    if (formIds.length === 0) return false;
    const [found] = await tx
        .select({ id: formDefinitions.id })
        .from(formDefinitions)
        .where(and(inArray(formDefinitions.id, [...formIds]), eq(formDefinitions.kind, 'block')))
        .limit(1);
    return Boolean(found);
}
