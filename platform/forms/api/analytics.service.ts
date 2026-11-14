/**
 * Form analytics (task 1.13f, form-platform.md §6): aggregate, no answer kept. The browser reports a fill's moments (opened, a
 * wizard step reached, stopped by the form's checks, submitted) and the server adds the requests it refuses; each is one row of
 * `form_events`, written once and audited like any write. What is read back is counts: how long a form takes, which fields stop
 * people most, and where unfinished fills were left. A field's key is kept, never what was typed.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { insertAudited, type DbContext, type Tx } from '@itrms/kernel/db';
import { NotFoundError, ValidationError } from '@itrms/kernel/errors';
import { publishedKeysOf, readDocument, wizardSteps } from '@itrms/form-engine/core';
import type { z } from 'zod';

import type { formAnalyticsQuerySchema, FormAnalytics, formEventInputSchema } from '../contracts';
import { formDefinitions, formEvents, formVersions } from './forms.table';
import { required } from './support';

/** What the browser reports, or 
efused: the server's own refusal of a submission's answers. */
type EventInput = Omit<z.infer<typeof formEventInputSchema>, 'kind'> & {
    kind: z.infer<typeof formEventInputSchema>['kind'] | 'refused';
};

/** A fill not submitted by this long after it was opened is counted as left unfinished. */
export const ABANDONED_AFTER_HOURS = 24;
/** The period when the caller names no start. */
export const DEFAULT_DAYS = 90;

@Injectable()
export class FormAnalyticsService {
    /**
     * One moment of a fill, on the version it was filled on (one of the form's own): the field keys are kept only when they are the
     * version's, a step only when it is one of its steps; nothing else is taken.
     */
    async record(tx: Tx, ctx: DbContext, formId: string, input: EventInput): Promise<void> {
        const [version] = await tx
            .select({ document: formVersions.document })
            .from(formVersions)
            .innerJoin(formDefinitions, eq(formDefinitions.id, formVersions.formId))
            .where(
                and(
                    eq(formVersions.id, input.formVersionId),
                    eq(formVersions.formId, formId),
                    eq(formDefinitions.kind, 'form')
                )
            );
        if (!version) throw new NotFoundError();
        const keys = publishedKeysOf(version.document);
        const steps = new Set(wizardSteps(readDocument(version.document).fields).map((s) => s.id));
        if (input.step !== undefined && !steps.has(input.step))
            throw new ValidationError('validation_failed', {
                errors: [{ path: 'step', code: 'unknown_step', message: 'not a step of this version' }]
            });
        const fieldKeys = [...new Set(input.fieldKeys ?? [])].filter((k) => keys.has(k));
        // a refusal that names none of the version's fields (a stale version, say) is not a field stopping anyone
        if (input.kind === 'refused' && fieldKeys.length === 0) return;
        // the row names who filled the form in, as every write does (created_by, the audit log): never shown with the figures
        await insertAudited(tx, formEvents, {
            regionId: required(ctx.regionId),
            unitId: required(ctx.unitId),
            formId,
            formVersionId: input.formVersionId,
            fill: input.fill,
            kind: input.kind,
            fieldKeys,
            step: input.step ?? null,
            seconds: input.kind === 'submitted' ? (input.seconds ?? null) : null
        });
    }

    /** The form's figures over a period, from the fills the caller's scope reads (its office's and those below). */
    async summary(tx: Tx, formId: string, query: z.infer<typeof formAnalyticsQuerySchema>): Promise<FormAnalytics> {
        const [form] = await tx
            .select({ id: formDefinitions.id })
            .from(formDefinitions)
            .where(eq(formDefinitions.id, formId));
        if (!form) throw new NotFoundError();
        // the period in Addis Ababa days: from the first one's start to the end of the last one
        const dayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
        const after = (day: string) => new Date(dayStart(day).getTime() + 86_400_000);
        // no start given: the last 90 days (the figures stay quick however long a form has been in use)
        const start = query.from ? dayStart(query.from) : new Date(Date.now() - DEFAULT_DAYS * 86_400_000);
        const end = query.to ? after(query.to) : undefined;
        const within = and(
            eq(formEvents.formId, formId),
            gte(formEvents.createdAt, start),
            end ? lt(formEvents.createdAt, end) : undefined
        );
        const [totals] = (
            await tx.execute<{ opened: number; submitted: number; stopped: number; median: number | null }>(sql`
                select count(distinct ${formEvents.fill}) filter (where ${formEvents.kind} = 'opened')::int as opened,
                       count(distinct ${formEvents.fill}) filter (where ${formEvents.kind} = 'submitted')::int as submitted,
                       count(*) filter (where ${formEvents.kind} in ('blocked', 'refused'))::int as stopped,
                       (percentile_cont(0.5) within group (order by ${formEvents.seconds})
                            filter (where ${formEvents.kind} = 'submitted'))::int as median
                  from ${formEvents}
                 where ${within}`)
        ).rows;
        const fields = (
            await tx.execute<{ key: string; count: number }>(sql`
                select k as key, count(*)::int as count
                  from ${formEvents}, unnest(${formEvents.fieldKeys}) as k
                 where ${within} and ${formEvents.kind} in ('blocked', 'refused')
                 group by k
                 order by count(*) desc, k
                 limit 20`)
        ).rows;
        // a fill opened long enough ago and never submitted: left at the last step it reached (none: before any step)
        const left = (
            await tx.execute<{ step: string | null; count: number }>(sql`
                with fills as (
                    -- a fill's whole story, whenever its later moments came (a fill opened in the period and submitted after
                    -- it was submitted); only the fills opened in the period count
                    select ${formEvents.fill} as fill,
                           bool_or(${formEvents.kind} = 'submitted') as submitted,
                           min(${formEvents.createdAt}) filter (where ${formEvents.kind} = 'opened') as opened_at,
                           (array_agg(${formEvents.step} order by ${formEvents.createdAt} desc, ${formEvents.id} desc)
                                filter (where ${formEvents.step} is not null))[1] as step
                      from ${formEvents}
                     where ${formEvents.formId} = ${formId}
                       and ${formEvents.fill} in (select ${formEvents.fill} from ${formEvents}
                                                  where ${within} and ${formEvents.kind} = 'opened')
                     group by ${formEvents.fill})
                select step, count(*)::int as count
                  from fills
                 where not submitted and opened_at < now() - make_interval(hours => ${ABANDONED_AFTER_HOURS})
                 group by step
                 order by count(*) desc, step nulls first`)
        ).rows;
        return {
            fills: { opened: totals?.opened ?? 0, submitted: totals?.submitted ?? 0, stopped: totals?.stopped ?? 0 },
            medianSeconds: totals?.median ?? null,
            fieldErrors: fields.map((f) => ({ key: f.key, count: f.count })),
            abandoned: left.map((r) => ({ step: r.step, count: r.count }))
        };
    }
}
