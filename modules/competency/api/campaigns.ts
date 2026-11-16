/**
 * The arithmetic of campaign counters (task 1.13i, ADR-0054 §2). No database: the service gathers the daily counts, these say what
 * they mean. Days are Gregorian `YYYY-MM-DD` in Africa/Addis_Ababa.
 */
import { CAMPAIGN_SERIES_DAYS, spanDays } from '../contracts';
import { daysAfter } from './bolo-validity';

/**
 * The last day the counts are of: today, never past the campaign's last day, and no later than the day it was closed (its closing
 * day counts, the days after do not).
 */
export function countingEnd(endsOn: string, closedDay: string | null, today: string): string {
    const last = today < endsOn ? today : endsOn;
    return closedDay !== null && closedDay < last ? closedDay : last;
}

/** The days of a campaign that have come by `today`, today included and never past its last day: 0 before it starts. */
export function elapsedDays(startsOn: string, endsOn: string, today: string): number {
    const last = today < endsOn ? today : endsOn;
    return Math.max(spanDays(startsOn, last), 0);
}

/** The share of a target the days gone by call for: an even pace over the campaign's days, rounded to a whole record. */
export function expectedBy(target: number, startsOn: string, endsOn: string, today: string): number {
    return Math.round((target * elapsedDays(startsOn, endsOn, today)) / spanDays(startsOn, endsOn));
}

/** On track when the count so far has reached the even pace. */
export const onTrack = (total: number, expected: number): boolean => total >= expected;

/** The last days up to `today`, oldest first, each with its count (zero when none was counted). */
export function seriesOf(
    counts: ReadonlyMap<string, number>,
    today: string,
    days = CAMPAIGN_SERIES_DAYS
): { day: string; count: number }[] {
    return Array.from({ length: days }, (_, i) => {
        const day = daysAfter(today, i - (days - 1));
        return { day, count: counts.get(day) ?? 0 };
    });
}

export interface OfficeFigures {
    today: number;
    total: number;
    target: number | null;
    expected: number | null;
}

export interface CampaignTotals extends OfficeFigures {
    /** the total of the offices that have a target: the pace is compared with this, not with the total of every office */
    targetedTotal: number;
}

/**
 * The totals across offices. The target and what is expected add the offices that have a target: an office counted without one adds
 * its records to today and total, and nothing to the target (nor to `targetedTotal`).
 */
export function totalsOf(offices: readonly OfficeFigures[]): CampaignTotals {
    const targeted = offices.filter((o) => o.target !== null);
    return {
        targetedTotal: targeted.reduce((n, o) => n + o.total, 0),
        today: offices.reduce((n, o) => n + o.today, 0),
        total: offices.reduce((n, o) => n + o.total, 0),
        target: targeted.length === 0 ? null : targeted.reduce((n, o) => n + (o.target ?? 0), 0),
        expected: targeted.length === 0 ? null : targeted.reduce((n, o) => n + (o.expected ?? 0), 0)
    };
}
