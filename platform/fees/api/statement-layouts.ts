/**
 * The layouts of a daily statement (task 0.22c, ADR-0043). No bank's or revenue office's real layout is known yet, so the
 * one layout here is a marked placeholder: a header row naming `reference`, `amount` and `date` (other columns are
 * ignored, and never kept). A real layout, or an ISO 20022 camt.053 file, is another entry of `LAYOUTS` and nothing else
 * changes. Parsing never throws on a line's content: a bad line is kept, marked, for a person to see.
 */
import { parse } from 'csv-parse/sync';

import { MAX_STATEMENT_LINES, STATEMENT_LAYOUT } from '../contracts';
import { addisToday } from './fees.service';

export interface ParsedLine {
    lineNo: number;
    reference: string | null;
    amountSantim: bigint | null;
    paidOn: string | null;
    /** why the line can't be matched */
    invalid: 'reference' | 'amount' | 'date' | 'future_date' | null;
}

export type ParsedStatement =
    { ok: true; lines: ParsedLine[] } | { ok: false; failure: 'header' | 'too_many_lines' | 'format' };

/** The amount as santim, by digits and never through a number: "1,250.50" is 125050n. Null when it isn't a credit. */
export function santimOfBirr(text: string): bigint | null {
    const value = text.trim();
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, the groups cannot overlap (linear time), and a statement's cells are bounded
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d{1,15})(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole = '0', cents = ''] = value.replaceAll(',', '').split('.');
    const santim = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'));
    return santim > 0n ? santim : null;
}

/** A real day, as YYYY-MM-DD: `2026-02-30` is not one. */
function isDay(text: string): boolean {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, fixed-length digit runs (linear time)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const day = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

/** Reads rows without judging them: a malformed file (an unclosed quote) gives null. */
function rowsOf(content: string): string[][] | null {
    try {
        return parse(content, {
            bom: true,
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true
        });
    } catch {
        return null;
    }
}

const REQUIRED = ['reference', 'amount', 'date'] as const;

/** Where the required columns are, by a header row in any case and order: null when one is missing. */
function columnsOf(header: readonly string[] | undefined): Record<(typeof REQUIRED)[number], number> | null {
    if (!header) return null;
    const names = header.map((h) => h.toLowerCase());
    const [reference, amount, date] = REQUIRED.map((name) => names.indexOf(name));
    if (reference === undefined || amount === undefined || date === undefined) return null;
    if (reference < 0 || amount < 0 || date < 0) return null;
    return { reference, amount, date };
}

/** The placeholder layout: `reference,amount,date`, an amount in Birr, a date in ISO form. */
function parsePlaceholder(content: string): ParsedStatement {
    const rows = rowsOf(content);
    if (!rows) return { ok: false, failure: 'format' };
    const columns = columnsOf(rows[0]);
    if (!columns) return { ok: false, failure: 'header' };
    const body = rows.slice(1);
    if (body.length > MAX_STATEMENT_LINES) return { ok: false, failure: 'too_many_lines' };
    const today = addisToday();
    return {
        ok: true,
        lines: body.map((row, i) => {
            const reference = (row[columns.reference] ?? '').slice(0, 80);
            const amountSantim = santimOfBirr(row[columns.amount] ?? '');
            const paidOn = (row[columns.date] ?? '').slice(0, 10);
            const validDay = (row[columns.date] ?? '').length === 10 && isDay(paidOn);
            let invalid: ParsedLine['invalid'] = null;
            if (reference === '') invalid = 'reference';
            else if (amountSantim === null) invalid = 'amount';
            else if (!validDay) invalid = 'date';
            else if (paidOn > today) invalid = 'future_date';
            return {
                lineNo: i + 1,
                reference: reference === '' ? null : reference,
                amountSantim,
                paidOn: validDay ? paidOn : null,
                invalid
            };
        })
    };
}

const LAYOUTS: Record<typeof STATEMENT_LAYOUT, (content: string) => ParsedStatement> = {
    [STATEMENT_LAYOUT]: parsePlaceholder
};

export const parseStatement = (layout: typeof STATEMENT_LAYOUT, content: string): ParsedStatement =>
    LAYOUTS[layout](content);

/** The first check, while the person waits: is this the layout at all? The lines are read by the worker. */
export function headerProblem(content: string): 'header' | 'format' | null {
    const firstLine = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).split(/\r?\n/, 1)[0] ?? '';
    const rows = rowsOf(firstLine);
    if (!rows) return 'format';
    return columnsOf(rows[0]) ? null : 'header';
}
