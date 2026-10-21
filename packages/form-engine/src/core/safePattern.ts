/**
 * Patterns written by form authors (field validation `pattern`, the `regex` condition operator) run on RE2, never on
 * JavaScript's backtracking engine, where a pattern like `(a+)+$` freezes the browser or, through server-side
 * validation, the API (security standard SEC-IN-2).
 *
 * RE2's matching time is bounded by (input length × compiled pattern size), so both are bounded here too: a pattern is at
 * most 200 characters (the form model's limit) with at most 100 counted repetitions in total (`{999}` would multiply the
 * pattern), and input longer than 4096 characters never matches. RE2 has no look-around or back-references; such a
 * pattern is unusable, like a syntax error, and `explainPattern` says why for the designer.
 */
import { RE2JS, RE2JSSyntaxException } from 're2js';

export type PatternTest = (input: string) => boolean;

export const MAX_PATTERN_LENGTH = 200;
export const MAX_COUNTED_REPEATS = 100;
export const MAX_INPUT_LENGTH = 4096;

const cache = new Map<string, PatternTest | null>();

const isHex = (c: string | undefined) =>
    !!c && ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));

/**
 * JavaScript's `\uXXXX` and `\u{X…}` escapes in RE2's form, `\x{XXXX}`: authors write Ethiopic ranges as
 * `[ሀ-፿]`, which RE2 would reject. An escaped backslash (`\\u`) is left alone.
 */
export function toRe2Syntax(source: string): string {
    let out = '';
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c !== '\\') {
            out += c;
            continue;
        }
        const next = source[i + 1];
        if (next === 'u' && source[i + 2] === '{') {
            const end = source.indexOf('}', i + 3);
            const hex = end > i + 3 ? source.slice(i + 3, end) : '';
            if (hex && [...hex].every(isHex)) {
                out += `\\x{${hex}}`;
                i = end;
                continue;
            }
        } else if (next === 'u' && [1, 2, 3, 4].every((k) => isHex(source[i + 1 + k]))) {
            out += `\\x{${source.slice(i + 2, i + 6)}}`;
            i += 5;
            continue;
        }
        // any other escape, including an escaped backslash, is copied as is
        out += c + (next ?? '');
        i += 1;
    }
    return out;
}

/** The sum of the counts in `{n}`, `{n,}` and `{n,m}` repetitions (the larger bound of each). */
export function countedRepeats(source: string): number {
    let total = 0;
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\\') {
            i += 1; // skip the escaped character
            continue;
        }
        if (source[i] !== '{') continue;
        const end = source.indexOf('}', i);
        if (end < 0) break;
        const body = source.slice(i + 1, end);
        const bounds = body.split(',');
        if (bounds.length <= 2 && bounds.every((b) => [...b].every((ch) => ch >= '0' && ch <= '9')) && bounds[0]) {
            total += Math.max(...bounds.map((b) => (b ? Number(b) : 0)));
            i = end;
        }
    }
    return total;
}

/** Why a pattern can't be used, for the designer; null when it can. */
export function explainPattern(source: string): string | null {
    if (source.length > MAX_PATTERN_LENGTH) return `A pattern can be at most ${MAX_PATTERN_LENGTH} characters.`;
    if (countedRepeats(source) > MAX_COUNTED_REPEATS)
        return `Counted repetitions such as {10} may add up to at most ${MAX_COUNTED_REPEATS}.`;
    try {
        RE2JS.compile(toRe2Syntax(source));
        return null;
    } catch (e) {
        if (!(e instanceof RE2JSSyntaxException)) throw e;
        return 'This pattern is invalid, or uses look-ahead, look-behind or back-references, which are not supported.';
    }
}

/** A matcher with the semantics of `RegExp.prototype.test` (a match anywhere), or null if the pattern can't be used. */
export function compilePattern(source: string): PatternTest | null {
    const hit = cache.get(source);
    if (hit !== undefined) return hit;
    let test: PatternTest | null = null;
    if (explainPattern(source) === null) {
        const re = RE2JS.compile(toRe2Syntax(source));
        test = (input) => input.length <= MAX_INPUT_LENGTH && re.matcher(input).find();
    }
    if (cache.size >= 200) cache.clear();
    cache.set(source, test);
    return test;
}
