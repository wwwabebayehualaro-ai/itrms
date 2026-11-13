/** A bolo's days (tasks 1.3a, 1.3b): the fiscal year it stands for and its last day, a temporary bolo's last day, and its reminder. */
import {
    fiscalYearOf,
    fiscalYearRange,
    formatEthiopianLong,
    toEthiopian,
    toGregorian
} from '@itrms/ethiopian-calendar';

import am from '../messages/am.json';

const iso = (d: { year: number; month: number; day: number }) =>
    `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * The fiscal year a bolo stands for and its last day: the Ethiopian fiscal year the vehicle was inspected in, to Sene 30 (the
 * stickers are printed per fiscal year). A stated rule until the zone says a category differs (asked: docs/discovery Q12).
 */
export function boloValidity(inspectedOn: string): { fiscalYear: number; validUntil: string } {
    const [year, month, day] = inspectedOn.split('-').map(Number);
    if (!year || !month || !day) throw new Error(`not a day: ${inspectedOn}`);
    const fiscalYear = fiscalYearOf(toEthiopian({ year, month, day }));
    return { fiscalYear, validUntil: iso(toGregorian(fiscalYearRange(fiscalYear).end)) };
}

/** The day a number of days after a Gregorian day (a temporary bolo's last day). */
export function daysAfter(day: string, days: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * When a bolo's owners are reminded: a number of days before its last day, at 08:00 in Addis Ababa (05:00 UTC; the country
 * keeps no summer time).
 */
export function reminderDue(validUntil: string, daysBefore: number): Date {
    return new Date(`${daysAfter(validUntil, -daysBefore)}T05:00:00Z`);
}

/** The reminder's text, in Amharic: the owners are not users with a language of their own. */
export function reminderText(plate: string, validUntil: string): string {
    const [year = 0, month = 1, day = 1] = validUntil.split('-').map(Number);
    const date = formatEthiopianLong(toEthiopian({ year, month, day }), { language: 'am' });
    return am['competency.notify.boloExpiring'].replaceAll('{plate}', plate).replaceAll('{date}', date);
}
