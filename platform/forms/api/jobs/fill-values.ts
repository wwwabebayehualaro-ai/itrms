/**
 * A published version made fields filterable (ADR-0035): their values are written for the form's existing submissions,
 * in batches, then the keys are recorded as complete (`indexed_keys`), from which point the queries use the value table.
 * Until then they filter on the answers: slower, never wrong.
 *
 * Every answer is read as the published version compares it, as the queries read the answers (a value of another kind
 * has no row, and reads as nothing on the answers too); a key is copied only where the submission's own version did not
 * restrict it. Rows of the
 * keys being filled are replaced, so a fill run again, or after a kind change, never keeps a stale one. The last step
 * holds the form's lock exclusively (submissions hold it shared), sweeps what was made meanwhile, and records the keys
 * the version published now still marks. A key with an answer of too many choices stays on the answers.
 */
import { eq, sql } from 'drizzle-orm';
import { updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { OutboxHandler } from '@itrms/kernel/api/worker';
import type { EngineField } from '@itrms/form-engine/core';

import { formPublishedV1, submissionExportRequestedV1 } from '../../contracts';
import { runExport, type ExportDeps } from './run-export';
import { formDefinitions, formVersions } from '../forms.table';
import { clearValues, lockFormExclusive, nextBatch, valueRows, writeValues, type FillRow } from '../submission-values';
import { fieldsFor } from '../support';
import { filterableKinds, valueFields, type Kind } from '../view-fields';

export const FILL_BATCH = 2000;
/** How long before a fill began a submission still in flight may have started (its `created_at`, a request's start). */
const IN_FLIGHT_MS = 15 * 60_000;

interface Plan {
    kinds: Map<string, Kind>;
    missing: string[];
    /** the published version's fields nobody is restricted from: every answer is read as these compare it */
    fields: EngineField[];
    /** each version's top-level value keys nobody is restricted from: only those of its submissions are copied */
    open: Map<string, Set<string>>;
    startedAt: Date;
}

/** The published version's filterable keys the value table does not hold for every submission yet. */
async function planOf(tx: Tx, formId: string): Promise<Plan> {
    const [form] = await tx.select().from(formDefinitions).where(eq(formDefinitions.id, formId));
    const rows = await tx
        .select({ id: formVersions.id, document: formVersions.document })
        .from(formVersions)
        .where(eq(formVersions.formId, formId));
    const versions = new Map(rows.map((v) => [v.id, fieldsFor(v.document, [])]));
    const published = (form?.publishedVersionId && versions.get(form.publishedVersionId)) || [];
    const kinds = filterableKinds(published);
    const open = new Map([...versions].map(([id, fields]) => [id, new Set(valueFields(fields).map((f) => f.key))]));
    const indexed = form?.indexedKeys ?? [];
    // the database's clock, as created_at is (the driver gives timestamps as text here)
    const now = await tx.execute<{ now: string }>(sql`select now()::text as now`);
    return {
        kinds,
        missing: [...kinds.keys()].filter((k) => !indexed.includes(k)),
        fields: published,
        open,
        startedAt: new Date(now.rows[0]?.now ?? Date.now())
    };
}

/** Writes one batch's rows again; returns the keys some submission holds too many choices for. */
async function refill(tx: Tx, formId: string, plan: Plan, batch: FillRow[]): Promise<string[]> {
    const kinds = new Map([...plan.kinds].filter(([k]) => plan.missing.includes(k)));
    const overflow = new Set<string>();
    const rows = batch.flatMap((s) => {
        // as the queries read the answers: by the published kind, of the keys the submission's own version left open
        const open = plan.open.get(s.form_version_id) ?? new Set<string>();
        const mine = new Map([...kinds].filter(([k]) => open.has(k)));
        const made = valueRows(plan.fields, mine, s.answers, {
            submissionId: s.id,
            formId,
            regionId: s.region_id,
            handlingUnitId: s.handling_unit_id
        });
        made.overflow.forEach((k) => overflow.add(k));
        return made.rows;
    });
    await clearValues(
        tx,
        formId,
        plan.missing,
        batch.map((s) => s.id)
    );
    await writeValues(tx, rows);
    return [...overflow];
}

export async function fillValues(system: SystemDatabase, formId: string): Promise<string[]> {
    const plan = await system.systemContext('forms.fill_values', (tx) => planOf(tx, formId), { detail: { formId } });
    if (plan.missing.length === 0) return [];
    const overflow = new Set<string>();
    for (let after: string | null = null, done = false; !done;) {
        // each batch reads and writes people's answers: audited, never "recurring"
        done = await system.systemContext(
            'forms.fill_values',
            async (tx) => {
                const batch = (await nextBatch(tx, formId, plan.missing, { after, size: FILL_BATCH })).rows;
                (await refill(tx, formId, plan, batch)).forEach((k) => overflow.add(k));
                after = batch[batch.length - 1]?.id ?? after;
                return batch.length < FILL_BATCH;
            },
            { detail: { formId, keys: plan.missing, after } }
        );
    }
    return system.systemContext(
        'forms.fill_values',
        async (tx) => {
            // no submission of the form is in flight from here on: those made while the batches ran (and any that read
            // the previous version before the publication) are swept
            await lockFormExclusive(tx, formId);
            const since = new Date(plan.startedAt.getTime() - IN_FLIGHT_MS);
            for (let after: string | null = null; ;) {
                const batch: FillRow[] = (await nextBatch(tx, formId, plan.missing, { after, size: FILL_BATCH, since }))
                    .rows;
                (await refill(tx, formId, plan, batch)).forEach((k) => overflow.add(k));
                if (batch.length < FILL_BATCH) break;
                after = batch[batch.length - 1]?.id ?? null;
            }
            const [locked] = await tx
                .select()
                .from(formDefinitions)
                .where(eq(formDefinitions.id, formId))
                .for('update');
            if (!locked) return [];
            const now = await planOf(tx, formId);
            const filled = plan.missing.filter((k) => now.kinds.get(k) === plan.kinds.get(k) && !overflow.has(k));
            const keys = [...new Set([...locked.indexedKeys.filter((k) => now.kinds.has(k)), ...filled])];
            if (keys.join() !== locked.indexedKeys.join())
                await updateAudited(tx, formDefinitions, formId, locked.rowVersion, { indexedKeys: keys });
            return filled;
        },
        { detail: { formId, keys: plan.missing } }
    );
}

/** The forms' outbox handlers; the background exports need the app's pool and the object store too. */
export function formsHandlers(system: SystemDatabase, deps?: ExportDeps): Record<string, OutboxHandler> {
    return {
        'form.published.v1': async (job) => {
            await fillValues(system, formPublishedV1.parse(job.payload).formId);
        },
        ...(deps
            ? {
                  'submission-export.requested.v1': async (job) => {
                      await runExport(system, deps, submissionExportRequestedV1.parse(job.payload).exportId);
                  }
              }
            : {})
    };
}
