/**
 * Month, weekday and era names per language (i18n-and-languages.md). Amharic and Tigrinya in Ethiopic script; English in
 * the usual transliteration; Afaan Oromo in Qubee. Wolaytta (`wal-Latn`) uses the Latin transliteration until the
 * translator's names arrive (phase-0 task 0.12): they are marked provisional so a screen can say so.
 */

export const CALENDAR_LANGUAGES = ['am', 'en', 'wal-Latn', 'om', 'ti'] as const;
export type CalendarLanguage = (typeof CALENDAR_LANGUAGES)[number];

/** Meskerem … Pagume, index 0 = month 1. */
export const MONTH_NAMES: Readonly<Record<CalendarLanguage, readonly string[]>> = {
    am: ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'],
    en: [
        'Meskerem',
        'Tikimt',
        'Hidar',
        'Tahsas',
        'Tir',
        'Yekatit',
        'Megabit',
        'Miyazya',
        'Ginbot',
        'Sene',
        'Hamle',
        'Nehase',
        'Pagume'
    ],
    'wal-Latn': [
        'Meskerem',
        'Tikimt',
        'Hidar',
        'Tahsas',
        'Tir',
        'Yekatit',
        'Megabit',
        'Miyazya',
        'Ginbot',
        'Sene',
        'Hamle',
        'Nehase',
        'Pagume'
    ],
    om: [
        'Fulbaana',
        'Onkoloolessa',
        'Sadaasa',
        'Muddee',
        'Amajjii',
        'Guraandhala',
        'Bitootessa',
        'Eebila',
        'Caamsaa',
        'Waxabajjii',
        'Adoolessa',
        'Hagayya',
        'Qaammee'
    ],
    ti: ['መስከረም', 'ጥቅምቲ', 'ሕዳር', 'ታሕሳስ', 'ጥሪ', 'ለካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰነ', 'ሓምለ', 'ነሓሰ', 'ጳጉሜን']
};

/** Sunday … Saturday, index 0 = Sunday. */
export const WEEKDAY_NAMES: Readonly<Record<CalendarLanguage, readonly string[]>> = {
    am: ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    'wal-Latn': ['Ehud', 'Segno', 'Maksegno', 'Rob', 'Hamus', 'Arb', 'Kidame'],
    om: ['Dilbata', 'Wiixata', 'Kibxata', 'Roobii', 'Kamiisa', 'Jimaata', 'Sanbata'],
    ti: ['ሰንበት', 'ሰኑይ', 'ሰሉስ', 'ረቡዕ', 'ሓሙስ', 'ዓርቢ', 'ቀዳም']
};

/** The era after a year: "2018 ዓ.ም", "2018 E.C.". */
export const ERA: Readonly<Record<CalendarLanguage, string>> = {
    am: 'ዓ.ም',
    en: 'E.C.',
    'wal-Latn': 'E.C.',
    om: 'A.L.I.',
    ti: 'ዓ.ም'
};

/** Names a translator has not confirmed yet: the transliterations that stand in for them. */
export const PROVISIONAL: ReadonlySet<CalendarLanguage> = new Set(['wal-Latn']);
