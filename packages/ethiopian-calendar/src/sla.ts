/**
 * When something is due (architecture.md §8, task 0.20a): the one helper that turns an SLA ("8 business hours", "10
 * business days") into an instant, with a working calendar (working hours per weekday, the lunch break as a gap, half
 * days, holidays) in Africa/Addis_Ababa. Never computed in SQL.
 *
 * - Business hours: the working time counted from the start (or from the next opening when the start is outside it).
 * - Business days: the end of the n-th working day after the start's day.
 */
import { gregorianToJdn, jdnToGregorian, weekday } from './convert';
import { addisDate, startOfAddisDay } from './business';
import { isoDate } from './holidays';

/** `HH:MM` – `HH:MM` in Addis Ababa. */
export type WorkingPeriod = readonly [from: string, to: string];

export interface WorkingCalendar {
    /** working periods per weekday, 0 = Sunday … 6 = Saturday; a gap between periods is the lunch break */
    week: Readonly<Record<number, readonly WorkingPeriod[]>>;
    /** non-working days, `YYYY-MM-DD` */
    holidays: ReadonlySet<string>;
    /** days that close early: `YYYY-MM-DD` → `HH:MM` */
    halfDays?: ReadonlyMap<string, string>;
}

export interface Sla {
    businessHours?: number;
    businessDays?: number;
}

/**
 * The Ethiopian civil service's week (Monday to Friday, 08:30–12:30 and 13:30–17:30 Addis time, i.e. 2:30–6:30 and 7:30–
 * 11:30 on the Ethiopian clock). A region may set its own (working_calendars).
 */
export const CIVIL_SERVICE_WEEK: Readonly<Record<number, readonly WorkingPeriod[]>> = Object.fromEntries(
    [1, 2, 3, 4, 5].map((d) => [
        d,
        [
            ['08:30', '12:30'],
            ['13:30', '17:30']
        ] as const
    ])
);

const minutesOf = (hhmm: string): number => {
    const [h = '', m = ''] = hhmm.split(':');
    const hours = Number(h);
    const minutes = Number(m);
    if (h.length !== 2 || m.length !== 2 || !(hours >= 0 && hours <= 23) || !(minutes >= 0 && minutes <= 59))
        throw new RangeError(`"${hhmm}" is not a time (HH:MM)`);
    return hours * 60 + minutes;
};

/** A day's working periods in minutes after midnight (Addis), a half day cut short, a holiday none. */
function periodsOf(jdn: number, calendar: WorkingCalendar): [number, number][] {
    const date = isoDate(jdnToGregorian(jdn));
    if (calendar.holidays.has(date)) return [];
    const closes = calendar.halfDays?.get(date);
    const until = closes === undefined ? 24 * 60 : minutesOf(closes);
    return (calendar.week[weekday(jdn)] ?? [])
        .map(([from, to]): [number, number] => [minutesOf(from), Math.min(minutesOf(to), until)])
        .filter(([from, to]) => to > from)
        .sort((a, b) => a[0] - b[0]);
}

const instantOf = (jdn: number, minute: number): Date =>
    new Date(startOfAddisDay(jdnToGregorian(jdn)).getTime() + minute * 60_000);

/** How far a search goes before it gives up: a calendar with no working day at all. */
const MAX_DAYS = 3 * 366;

/** When an SLA started at `start` is due, on `calendar`. */
export function businessDeadline(start: Date, sla: Sla, calendar: WorkingCalendar): Date {
    if (Number.isNaN(start.getTime())) throw new RangeError('Not a valid instant');
    const day0 = gregorianToJdn(addisDate(start));
    // whole minutes: a start within a minute counts from the next one
    const startMinute = Math.ceil((start.getTime() - startOfAddisDay(addisDate(start)).getTime()) / 60_000);
    if (sla.businessDays !== undefined) {
        if (!Number.isInteger(sla.businessDays) || sla.businessDays < 1) throw new RangeError('businessDays ≥ 1');
        let left = sla.businessDays;
        for (let jdn = day0 + 1; jdn <= day0 + MAX_DAYS; jdn++) {
            const periods = periodsOf(jdn, calendar);
            const last = periods[periods.length - 1];
            if (!last) continue;
            if (--left === 0) return instantOf(jdn, last[1]);
        }
        throw new RangeError('The calendar has no working days');
    }
    if (sla.businessHours === undefined || !(sla.businessHours > 0)) throw new RangeError('An SLA needs hours or days');
    let left = Math.round(sla.businessHours * 60);
    for (let jdn = day0; jdn <= day0 + MAX_DAYS; jdn++) {
        for (const [from, to] of periodsOf(jdn, calendar)) {
            const begin = jdn === day0 ? Math.max(from, startMinute) : from;
            if (begin >= to) continue;
            if (to - begin >= left) return instantOf(jdn, begin + left);
            left -= to - begin;
        }
    }
    throw new RangeError('The calendar has no working time');
}
