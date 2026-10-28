// When an SLA is due (task 0.20a): working hours, lunch, weekends, holidays and half days in Addis Ababa time.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ethiopianHolidays, orthodoxEaster } from './holidays';
import { businessDeadline, CIVIL_SERVICE_WEEK, type WorkingCalendar } from './sla';

/** An instant given in Addis Ababa local time (UTC+3). */
const addis = (iso: string) => new Date(`${iso}+03:00`);
const calendar = (holidays: string[] = [], halfDays: [string, string][] = []): WorkingCalendar => ({
    week: CIVIL_SERVICE_WEEK,
    holidays: new Set(holidays),
    halfDays: new Map(halfDays)
});
const local = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);

describe('businessDeadline', () => {
    it('lands 8 business hours from Friday 16:00 on Monday 16:00, and on Tuesday across the Adwa holiday', () => {
        // 27 February 2026 is a Friday; Adwa (2 March) a Monday
        const friday = addis('2026-02-27T16:00:00');
        expect(local(businessDeadline(friday, { businessHours: 8 }, calendar()))).toBe('2026-03-02T16:00');
        const adwa = ethiopianHolidays(2026).map((h) => h.date);
        expect(adwa).toContain('2026-03-02');
        expect(local(businessDeadline(friday, { businessHours: 8 }, calendar(adwa)))).toBe('2026-03-03T16:00');
    });

    it('skips the lunch break and starts counting at the next opening', () => {
        // 12:00 Monday: 30 minutes before lunch, then from 13:30
        expect(local(businessDeadline(addis('2026-03-09T12:00:00'), { businessHours: 1 }, calendar()))).toBe(
            '2026-03-09T14:00'
        );
        // before opening and on a Saturday: counted from the next opening
        expect(local(businessDeadline(addis('2026-03-09T06:00:00'), { businessHours: 2 }, calendar()))).toBe(
            '2026-03-09T10:30'
        );
        expect(local(businessDeadline(addis('2026-03-07T10:00:00'), { businessHours: 2 }, calendar()))).toBe(
            '2026-03-09T10:30'
        );
    });

    it('closes a half day early', () => {
        const half = calendar([], [['2026-03-09', '12:30']]);
        expect(local(businessDeadline(addis('2026-03-09T11:30:00'), { businessHours: 2 }, half))).toBe(
            '2026-03-10T09:30'
        );
    });

    it('ends business days at the close of the n-th working day after the start', () => {
        // Thursday + 2 business days: Friday, Monday (a weekend between)
        expect(local(businessDeadline(addis('2026-03-05T10:00:00'), { businessDays: 2 }, calendar()))).toBe(
            '2026-03-09T17:30'
        );
    });

    it('stores an instant: 17:30 Addis is 14:30 UTC', () => {
        const due = businessDeadline(addis('2026-03-05T10:00:00'), { businessDays: 1 }, calendar());
        expect(due.toISOString()).toBe('2026-03-06T14:30:00.000Z');
    });

    it('refuses a calendar with no working time, and an SLA without hours or days', () => {
        const none: WorkingCalendar = { week: {}, holidays: new Set() };
        expect(() => businessDeadline(new Date(), { businessHours: 1 }, none)).toThrow('no working time');
        expect(() => businessDeadline(new Date(), {}, calendar())).toThrow('hours or days');
    });

    it('is always later than the start, and in working time (whole minutes)', () => {
        fc.assert(
            fc.property(
                fc.date({ min: new Date('2026-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }),
                fc.integer({ min: 1, max: 40 }),
                (start, hours) => {
                    const due = businessDeadline(
                        start,
                        { businessHours: hours },
                        calendar(ethiopianHolidays(2026).map((h) => h.date))
                    );
                    const [hh = 0, mm = 0] = local(due).slice(11).split(':').map(Number);
                    const minute = hh * 60 + mm;
                    const weekday = new Date(due.getTime() + 3 * 3600_000).getUTCDay();
                    return (
                        due > start &&
                        weekday >= 1 &&
                        weekday <= 5 &&
                        ((minute > 8 * 60 + 30 && minute <= 12 * 60 + 30) ||
                            (minute > 13 * 60 + 30 && minute <= 17 * 60 + 30))
                    );
                }
            )
        );
    });
});

describe('ethiopianHolidays', () => {
    it('computes the Orthodox Easter', () => {
        expect(orthodoxEaster(2026)).toEqual({ year: 2026, month: 4, day: 12 });
        expect(orthodoxEaster(2027)).toEqual({ year: 2027, month: 5, day: 2 });
        expect(orthodoxEaster(2025)).toEqual({ year: 2025, month: 4, day: 20 });
    });

    it('keeps the fixed holidays by their Ethiopian dates, and marks the Muslim ones provisional', () => {
        const days = Object.fromEntries(ethiopianHolidays(2026).map((h) => [h.key, h]));
        expect(days.genna?.date).toBe('2026-01-07');
        expect(days.timket?.date).toBe('2026-01-19');
        expect(days.enkutatash?.date).toBe('2026-09-11');
        expect(days.meskel?.date).toBe('2026-09-27');
        expect(days.good_friday?.date).toBe('2026-04-10');
        expect(days.patriots?.date).toBe('2026-05-05');
        expect(days.derg_downfall?.date).toBe('2026-05-28');
        expect(days.eid_al_fitr).toMatchObject({ provisional: true });
        expect(days.genna).not.toHaveProperty('provisional');
        // a year before an Ethiopian leap year moves Enkutatash to 12 September
        expect(ethiopianHolidays(2027).find((h) => h.key === 'enkutatash')?.date).toBe('2027-09-12');
    });
});
