/**
 * Campaigns (ADR-0054 §2, task 1.13i): a unit runs a campaign over a span of days (the plate exchange of task 1.2c, the bolo season of
 * task 1.3), sets a target for each office below it, and the dashboard shows each office's daily count against it. What is counted comes
 * from typed tables only: a plate exchanged on its day, a bolo inspected on its day, never form answers.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

export const CAMPAIGN_KINDS = ['plate_exchange', 'bolo_season'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/** A campaign lasts at most one year (a leap year's days). */
export const MAX_CAMPAIGN_DAYS = 366;
export const MAX_CAMPAIGN_TARGET = 10_000_000;
/** The days of the series each office shows, today the last. */
export const CAMPAIGN_SERIES_DAYS = 14;

/** The days from `from` to `to`, both Gregorian `YYYY-MM-DD`, inclusive of both: a campaign of one day is 1. */
export function spanDays(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export const campaignCreateSchema = z
    .strictObject({
        kind: z.enum(CAMPAIGN_KINDS),
        name: i18nTextSchema,
        startsOn: z.iso.date(),
        endsOn: z.iso.date()
    })
    .superRefine((v, ctx) => {
        const span = spanDays(v.startsOn, v.endsOn);
        if (span < 1) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'ends before it starts' });
        else if (span > MAX_CAMPAIGN_DAYS)
            ctx.addIssue({ code: 'custom', path: ['endsOn'], message: `lasts more than ${MAX_CAMPAIGN_DAYS} days` });
    });
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignTargetSchema = z.strictObject({
    unitId: z.uuid(),
    target: z.number().int().min(1).max(MAX_CAMPAIGN_TARGET)
});
export type CampaignTargetInput = z.infer<typeof campaignTargetSchema>;

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const campaignSchema = z.object({
    id: z.uuid(),
    kind: z.enum(CAMPAIGN_KINDS),
    name: z.record(z.string(), z.string()),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    closedAt: z.string().nullable(),
    /** the unit that runs it */
    unit: unitRefSchema,
    version: z.number().int()
});
export type Campaign = z.infer<typeof campaignSchema>;

export const campaignOfficeSchema = z.object({
    unit: unitRefSchema,
    /** none: counted without a target set for the office */
    target: z.object({ count: z.number().int(), version: z.number().int() }).nullable(),
    today: z.number().int(),
    total: z.number().int(),
    /** the share of the target the days gone by call for: null without a target */
    expected: z.number().int().nullable(),
    /** total at or above expected; null without a target */
    onTrack: z.boolean().nullable(),
    /** the last days, today the last, none left out */
    series: z.array(z.object({ day: z.iso.date(), count: z.number().int() }))
});
export type CampaignOffice = z.infer<typeof campaignOfficeSchema>;

export const campaignProgressSchema = z.object({
    campaign: campaignSchema,
    offices: z.array(campaignOfficeSchema),
    total: z.object({
        today: z.number().int(),
        total: z.number().int(),
        target: z.number().int().nullable(),
        expected: z.number().int().nullable()
    }),
    /** whether the caller may set targets and close it (it is theirs to run) */
    mayManage: z.boolean(),
    /** the caller's active unit: it is never offered a target of its own */
    ownUnitId: z.uuid().nullable()
});
export type CampaignProgress = z.infer<typeof campaignProgressSchema>;

export const campaignListSchema = z.object({ items: z.array(campaignSchema), mayManage: z.boolean() });
export type CampaignList = z.infer<typeof campaignListSchema>;
