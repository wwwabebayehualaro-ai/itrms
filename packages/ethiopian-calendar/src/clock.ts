/**
 * The Ethiopian 12-hour clock (optional display): the day's first hour starts at 06:00, so 07:00 is "1 o'clock in the
 * morning" and 19:00 "1 o'clock in the evening". The period names the part of the day.
 */
import type { CalendarLanguage } from './names';

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface EthiopianTime {
    /** 1–12 */
    hour: number;
    minute: number;
    period: DayPeriod;
}

/** From a 24-hour time in Addis Ababa (`hour` 0–23). */
export function toEthiopianTime(hour: number, minute: number): EthiopianTime {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
        throw new RangeError(`Not a time: ${hour}:${minute}`);
    const period: DayPeriod = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return { hour: (hour + 6) % 12 || 12, minute, period };
}

export const PERIOD_NAMES: Readonly<Record<CalendarLanguage, Readonly<Record<DayPeriod, string>>>> = {
    am: { morning: 'ጠዋት', afternoon: 'ከሰዓት', evening: 'ምሽት', night: 'ሌሊት' },
    ti: { morning: 'ንግሆ', afternoon: 'ድሕሪ ቀትሪ', evening: 'ምሸት', night: 'ለይቲ' },
    en: { morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night' },
    'wal-Latn': { morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night' },
    om: { morning: 'ganama', afternoon: 'waaree booda', evening: 'galgala', night: 'halkan' }
};

/** "1:30 ጠዋት" for 07:30. */
export function formatEthiopianTime(hour: number, minute: number, language: CalendarLanguage = 'am'): string {
    const t = toEthiopianTime(hour, minute);
    return `${t.hour}:${String(t.minute).padStart(2, '0')} ${PERIOD_NAMES[language][t.period]}`;
}
