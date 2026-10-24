/**
 * A published version made fields filterable (ADR-0035): their values are written for the form's existing submissions,
 * in batches, then the keys are recorded as complete (`indexed_keys`), from which point the queries use the value table.
 * Until then they filter on the answers: slower, never wrong. Idempotent: a batch run again writes nothing new.
 * A submission made meanwhile writes its own values; a version published meanwhile is read again before the keys count.
 */
import { eq } from 'drizzle-orm';
import { updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import { readDocument, type EngineField } from '@itrms/form-engine/core';

import { formPublishedV1 } from '../../contracts';
import { formDefinitions, formVersions } from '../forms.table';
import { nextBatch, valueRows, writeValues } from '../submission-values';
import { filterableKeys } from '../view-fields';

export const FILL_BATCH = 2000;

/** The published version's fields, and its filterable keys the value table does not hold for every submission yet. */
async function missing(
    tx: Tx,
    formId: string
): Promise<{ fields: EngineField[]; marked: string[]; missing: string[] }> {
    const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, formId));
    if (!form?.publishedVersionId) return { fields: [], marked: [], missing: [] };
    const [version] = await tx
        .select({ document: formVersions.document })
        .from(formVersions)
        .where(eq(formVersions.id, form.publishedVersionId));
    const fields = readDocument(version?.document).fields;
    const marked = filterableKeys(fields);
    return { fields, marked, missing: marked.filter((k) => !form.indexedKeys.includes(k)) };
}

export async function fillValues(system: SystemDatabase, formId: string): Promise<string[]> {
    const plan = await system.systemContext('forms.fill_values', (tx) => missing(tx, formId), { detail: { formId } });
    if (plan.missing.length === 0) return [];
    for (let after: string | null = null; ;) {
        const done: boolean = await system.systemContext(
            'forms.fill_values',
            async (tx) => {
                const batch = (await nextBatch(tx, formId, after, FILL_BATCH)).rows;
                await writeValues(
                    tx,
                    batch.flatMap((s) =>
                        valueRows(plan.fields, plan.missing, s.answers, {
                            submissionId: s.id,
                            formId,
                            regionId: s.region_id,
                            handlingUnitId: s.handling_unit_id
                        })
                    )
                );
                after = batch[batch.length - 1]?.id ?? after;
                return batch.length < FILL_BATCH;
            },
            { recurring: true }
        );
        if (done) break;
    }
    // the keys count once filled, if the version published now still marks them
    return system.systemContext(
        'forms.fill_values',
        async (tx) => {
            const [locked] = await tx
                .select()
                .from(formDefinitions)
                .where(eq(formDefinitions.id, formId))
                .for('update');
            if (!locked) return [];
            const now = await missing(tx, formId);
            const filled = plan.missing.filter((k) => now.marked.includes(k));
            const keys = [...new Set([...locked.indexedKeys.filter((k) => now.marked.includes(k)), ...filled])];
            if (keys.join() !== locked.indexedKeys.join())
                await updateAudited(tx, formDefinitions, formId, locked.rowVersion, { indexedKeys: keys });
            return filled;
        },
        { detail: { formId, keys: plan.missing } }
    );
}

export function formsHandlers(system: SystemDatabase): Record<string, OutboxHandler> {
    return {
        'form.published.v1': async (job) => {
            await fillValues(system, formPublishedV1.parse(job.payload).formId);
        }
    };
}
