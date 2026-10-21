/**
 * Birr text ↔ santim (`bigint`, 1 Birr = 100 santim; ADR-0014). The conversion works on the digits as text and never
 * goes through a JS number, so no amount is ever a float. The shared `Money` type arrives in packages/schemas (task 0.5);
 * these helpers move there with it.
 */

/** At most 15 digits of Birr: far above any fee or contract, well inside a Postgres bigint of santim. */
export const MAX_BIRR_DIGITS = 15;

export type ParsedBirr =
    { ok: true; santim: bigint | null } | { ok: false; error: 'format' | 'precision' | 'negative' | 'too-large' };

// Grouping is written with commas or spaces (also no-break and narrow no-break), and only between groups of three digits:
// "12,50" is someone's 12.50 written with a decimal comma, and reading it as 1,250 would make it 100 times larger.
const AMOUNT = /^(-?)(\d*)(?:\.(\d*))?$/;
const GROUPED = /^-?\d{1,3}(?:[,\s]\d{3})+(?:\.\d*)?$/; // \s also covers the no-break and narrow no-break spaces
const SEPARATORS = /[,\s]/g;

/**
 * Reads typed Birr: "1,250.5" → 125050n, "" → null. At most two decimals (santim); a third is an error, never rounded.
 * A separator out of place ("12,50", "1 2") is a format error. A lone "-" or "." is an amount still being typed and reads
 * as null.
 */
export function parseBirr(text: string, { allowNegative = false }: { allowNegative?: boolean } = {}): ParsedBirr {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- GROUPED and AMOUNT are anchored, each repetition starts with a required separator or digit run of fixed length (linear time)
    const m = AMOUNT.exec(GROUPED.test(text) ? text.replace(SEPARATORS, '') : text);
    if (!m) return { ok: false, error: 'format' };
    const [, sign = '', birr = '', santim = ''] = m;
    if (sign && !allowNegative) return { ok: false, error: 'negative' };
    if (santim.length > 2) return { ok: false, error: 'precision' };
    if (birr.replace(/^0+/, '').length > MAX_BIRR_DIGITS) return { ok: false, error: 'too-large' };
    if (!birr && !santim) return { ok: true, santim: null };
    const value = BigInt(birr || '0') * 100n + BigInt(santim.padEnd(2, '0'));
    return { ok: true, santim: sign && value !== 0n ? -value : value };
}

/**
 * Thousands grouping still being typed: "1,2" and "1,25" on the way to "1,250". It is not an amount yet (it reads as no
 * value), and it must never be read as one: "12,50" may be a decimal comma.
 */
export function isGroupingInProgress(text: string): boolean {
    return /^-?\d{1,3}(?:[,\s]\d{3})*[,\s]\d{0,2}$/.test(text);
}

/** Pasted text keeps only the amount: a currency word before or after it ("ETB 1,250.50", "500 ብር") is dropped. */
export function stripCurrency(text: string): string {
    return text
        .trim()
        .replace(/^[^\d.-]+/, '')
        .replace(/[^\d.]+$/, '');
}

/** "1,250.50": grouped Birr with both santim digits. The same digits and separators serve Amharic and English. */
export function formatBirr(santim: bigint, { grouping = true }: { grouping?: boolean } = {}): string {
    const negative = santim < 0n;
    const abs = negative ? -santim : santim;
    const birr = (abs / 100n).toString();
    const cents = (abs % 100n).toString().padStart(2, '0');
    const grouped = grouping ? birr.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : birr;
    return `${negative ? '-' : ''}${grouped}.${cents}`;
}
