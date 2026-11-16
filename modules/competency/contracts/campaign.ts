/**
 * Campaigns (ADR-0054 §2, task 1.13i): a unit runs a campaign over a span of days (the plate exchange of task 1.2c, the bolo season of
 * task 1.3), sets a target for each office below it, and the dashboard shows each office's daily count against it. What is counted comes
 * from typed tables only: a plate exchanged on its day, a bolo inspected on its day, never form answers.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

import { BOLO_SERVICE } from './bolo';
import { PLATE_EXCHANGE_SERVICE } from './exchange';

export const CAMPAIGN_KINDS = ['plate_exchange', 'bolo_season'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

/**
 * The service whose records a campaign counts. An office is given a target only if it offers it, so a target compares an office with
 * its own records, and the totals never count a nested office's records twice.
 */
export const CAMPAIGN_SERVICES: Record<CampaignKind, string> = {
    plate_exchange: PLATE_EXCHANGE_SERVICE,
    bolo_season: BOLO_SERVICE
};

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
        expected: z.number().int().nullable(),
        /** the total of the offices that have a target only: what the pace is compared with */
        targetedTotal: z.number().int()
    }),
    /** whether the caller may set targets: it is theirs to run, or they hold offices below them that may be given one */
    mayManage: z.boolean(),
    /** whether the caller may close it: the unit that runs it, or one above */
    mayClose: z.boolean(),
    /** the offices the caller may give a first target (below the campaign's unit and the caller's, offering the service); at most 300 */
    candidates: z.array(unitRefSchema),
    /** the caller's active unit: it is never offered a target of its own */
    ownUnitId: z.uuid().nullable()
});
export type CampaignProgress = z.infer<typeof campaignProgressSchema>;

export const campaignListSchema = z.object({
    items: z.array(campaignSchema),
    mayManage: z.boolean(),
    /** the campaigns among the items run by the caller's unit or a unit above it (the others were started below) */
    heldAbove: z.array(z.uuid())
});
export type CampaignList = z.infer<typeof campaignListSchema>;
