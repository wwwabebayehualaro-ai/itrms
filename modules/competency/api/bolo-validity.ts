/** A bolo's days (task 1.3a): the fiscal year it stands for and its last day, and a temporary bolo's last day. */
import { fiscalYearOf, fiscalYearRange, toEthiopian, toGregorian } from '@itrms/ethiopian-calendar';

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
