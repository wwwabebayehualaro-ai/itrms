/**
 * Ethiopia's public holidays of a Gregorian year (task 0.20a): the fixed ones (most kept by their Ethiopian date), Good
 * Friday and Fasika (the Orthodox Easter, computed), and the Muslim ones, which follow the moon and are announced each
 * year: those come from a short table of PROVISIONAL dates to be confirmed by the region (a marked placeholder; an
 * installation corrects or adds days in its holidays table).
 */
import { gregorianToJdn, jdnToGregorian, toGregorian, type GregorianDate } from './convert';

export interface Holiday {
    /** YYYY-MM-DD, the Gregorian date in Addis Ababa */
    date: string;
    key: string;
    name: { am: string; en: string };
    /** a date to be confirmed (the Muslim holidays, fixed by the moon) */
    provisional?: boolean;
}

export const isoDate = (d: GregorianDate): string =>
    `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** The Orthodox Easter (Fasika) of a Gregorian year: the Julian computus, moved to the Gregorian calendar. */
export function orthodoxEaster(year: number): GregorianDate {
    if (!Number.isInteger(year) || year < 1900 || year > 2099) throw new RangeError('Easter is computed for 1900–2099');
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);
    const day = ((d + e + 114) % 31) + 1;
    // the Julian date, then 13 days later in the Gregorian calendar (1900–2099)
    return jdnToGregorian(gregorianToJdn({ year, month, day }) + 13);
}

/**
 * The Muslim holidays' dates as expected (Eid al-Fitr, Eid al-Adha, Mawlid), PROVISIONAL: each is announced on the moon's
 * sighting and may move by a day. To be confirmed by the region each year.
 */
const MUSLIM: Readonly<Record<number, readonly [key: string, date: string][]>> = {
    2026: [
        ['eid_al_fitr', '2026-03-20'],
        ['eid_al_adha', '2026-05-27'],
        ['mawlid', '2026-08-26']
    ],
    2027: [
        ['eid_al_fitr', '2027-03-10'],
        ['eid_al_adha', '2027-05-17'],
        ['mawlid', '2027-08-15']
    ],
    2028: [
        ['eid_al_fitr', '2028-02-27'],
        ['eid_al_adha', '2028-05-05'],
        ['mawlid', '2028-08-04']
    ]
};

const NAMES: Readonly<Record<string, { am: string; en: string }>> = {
    genna: { am: 'ገና', en: 'Ethiopian Christmas' },
    timket: { am: 'ጥምቀት', en: 'Epiphany' },
    adwa: { am: 'የዓድዋ ድል በዓል', en: 'Victory of Adwa' },
    good_friday: { am: 'ስቅለት', en: 'Good Friday' },
    fasika: { am: 'ፋሲካ', en: 'Easter' },
    labour: { am: 'የሠራተኞች ቀን', en: 'International Labour Day' },
    patriots: { am: 'የአርበኞች ቀን', en: "Patriots' Victory Day" },
    derg_downfall: { am: 'ግንቦት 20', en: 'Downfall of the Derg' },
    enkutatash: { am: 'እንቁጣጣሽ', en: 'Ethiopian New Year' },
    meskel: { am: 'መስቀል', en: 'Finding of the True Cross' },
    eid_al_fitr: { am: 'ኢድ አልፈጥር', en: 'Eid al-Fitr' },
    eid_al_adha: { am: 'ኢድ አልአድሃ (አረፋ)', en: 'Eid al-Adha' },
    mawlid: { am: 'መውሊድ', en: 'Mawlid' }
};

const holiday = (key: string, date: GregorianDate | string, provisional?: boolean): Holiday => ({
    date: typeof date === 'string' ? date : isoDate(date),
    key,
    name: NAMES[key] ?? { am: key, en: key },
    ...(provisional ? { provisional } : {})
});

/** The public holidays of a Gregorian year, in date order. */
export function ethiopianHolidays(year: number): Holiday[] {
    // the Ethiopian year running from January to September, and the one starting in September
    const early = year - 8;
    const late = year - 7;
    const easter = orthodoxEaster(year);
    const days: Holiday[] = [
        // Genna falls on 7 January (Tahsas 29, or 28 after an Ethiopian leap year)
        holiday('genna', { year, month: 1, day: 7 }),
        holiday('timket', toGregorian({ year: early, month: 5, day: 11 })),
        holiday('adwa', toGregorian({ year: early, month: 6, day: 23 })),
        holiday('good_friday', jdnToGregorian(gregorianToJdn(easter) - 2)),
        holiday('fasika', easter),
        holiday('labour', { year, month: 5, day: 1 }),
        holiday('patriots', toGregorian({ year: early, month: 8, day: 27 })),
        holiday('derg_downfall', toGregorian({ year: early, month: 9, day: 20 })),
        holiday('enkutatash', toGregorian({ year: late, month: 1, day: 1 })),
        holiday('meskel', toGregorian({ year: late, month: 1, day: 17 })),
        ...(MUSLIM[year] ?? []).map(([key, date]) => holiday(key, date, true))
    ];
    return days.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}
