/**
 * When a step or a wait is due (architecture.md §8, task 0.20a): its state's SLA on the working calendar of the unit it is
 * in, computed by the calendar package's one helper (`businessDeadline`), never in SQL. A unit's calendar is the nearest
 * working_calendars row up its tree (the civil service's week without one); its holidays are the national ones the
 * package computes plus the holidays rows of the unit and the units above it.
 */
import { inArray } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import {
    addisDate,
    businessDeadline,
    CIVIL_SERVICE_WEEK,
    ethiopianHolidays,
    type Sla,
    type WorkingCalendar,
    type WorkingPeriod
} from '@itrms/ethiopian-calendar';

import { holidays, workingCalendars } from './workflow.table';

/** The working calendar of the last unit of `chain` (the region first). */
export async function calendarOf(tx: Tx, chain: readonly string[], from: Date): Promise<WorkingCalendar> {
    const own = await tx
        .select()
        .from(workingCalendars)
        .where(inArray(workingCalendars.unitId, [...chain]));
    // the nearest one up the tree
    const nearest = [...own].sort((a, b) => chain.indexOf(b.unitId) - chain.indexOf(a.unitId))[0];
    const week: Record<number, readonly WorkingPeriod[]> = nearest
        ? Object.fromEntries(Object.entries(nearest.week).map(([day, periods]) => [Number(day), periods]))
        : { ...CIVIL_SERVICE_WEEK };
    const year = addisDate(from).year;
    const days = new Set([year, year + 1, year + 2].flatMap((y) => ethiopianHolidays(y).map((h) => h.date)));
    for (const h of await tx
        .select({ date: holidays.date })
        .from(holidays)
        .where(inArray(holidays.unitId, [...chain])))
        days.add(h.date);
    return { week, holidays: days, halfDays: new Map(Object.entries(nearest?.halfDays ?? {})) };
}

/** When `sla` started at `from` is due in the last unit of `chain`. */
export async function dueAt(tx: Tx, chain: readonly string[], sla: Sla, from = new Date()): Promise<Date> {
    return businessDeadline(from, sla, await calendarOf(tx, chain, from));
}
