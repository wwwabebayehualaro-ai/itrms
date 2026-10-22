/**
 * Search folding (i18n-and-languages.md; used by the registers' name search, task 0.14): two spellings people write for
 * the same name must find each other.
 *   - Ethiopic homophones: the letters that sound the same are written either way (ሐ ኀ → ሀ, ሠ → ሰ, ዐ → አ, ፀ → ጸ), in
 *     every vowel order; and the first and fourth orders of h and of the glottal stop sound alike too (ሃ → ሀ, ኣ → አ).
 *   - Wolaytta (Latin script) writes its glottal stop as ' ’ ʼ ‘ or 7 (between letters): one form.
 *   - Case, Latin diacritics and runs of spaces do not count.
 * The folded form is for matching only, never shown.
 */

/** [first letter of a series to fold, first letter it folds to, letters in the series] */
const HOMOPHONES: readonly [number, number, number][] = [
    [0x1210, 0x1200, 7], // ሐ ሑ ሒ ሓ ሔ ሕ ሖ → ሀ ሁ ሂ ሃ ሄ ህ ሆ
    [0x1280, 0x1200, 7], // ኀ ኁ ኂ ኃ ኄ ኅ ኆ → ሀ …
    [0x1220, 0x1230, 8], // ሠ … ሧ → ሰ … ሷ
    [0x12d0, 0x12a0, 7], // ዐ ዑ ዒ ዓ ዔ ዕ ዖ → አ ኡ ኢ ኣ ኤ እ ኦ
    [0x1340, 0x1338, 7] // ፀ ፁ ፂ ፃ ፄ ፅ ፆ → ጸ ጹ ጺ ጻ ጼ ጽ ጾ
];

/** After the series: ሃ → ሀ and ኣ → አ (4th order "a" read as the 1st). */
const SAME_VOWEL: Readonly<Record<number, number>> = { 0x1203: 0x1200, 0x12a3: 0x12a0 };

const FOLD = new Map<number, string>();
for (const [from, to, length] of HOMOPHONES)
    for (let i = 0; i < length; i++) {
        const target = to + i;
        FOLD.set(from + i, String.fromCodePoint(SAME_VOWEL[target] ?? target));
    }
for (const [from, to] of Object.entries(SAME_VOWEL)) FOLD.set(Number(from), String.fromCodePoint(to));

const APOSTROPHES = /['’ʼ‘`]/g;
const SEVEN_AS_GLOTTAL_STOP = /(?<=\p{L})7|7(?=\p{L})/gu;

export function foldForSearch(text: string): string {
    const latin = text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .normalize('NFC')
        .toLowerCase()
        .replace(SEVEN_AS_GLOTTAL_STOP, "'")
        .replace(APOSTROPHES, "'")
        .replace(/\s+/g, ' ')
        .trim();
    let out = '';
    for (const char of latin) out += FOLD.get(char.codePointAt(0) ?? 0) ?? char;
    return out;
}
