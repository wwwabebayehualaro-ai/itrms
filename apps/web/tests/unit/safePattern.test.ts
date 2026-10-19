import { describe, expect, it } from 'vitest';

import { evaluateAll } from '@/form-engine/core/conditions';
import {
    compilePattern,
    countedRepeats,
    explainPattern,
    MAX_INPUT_LENGTH,
    toRe2Syntax
} from '@/form-engine/core/safePattern';
import type { VisibilityCondition } from '@/form-engine/core/storedTypes';

const BS = String.fromCharCode(92); // a backslash, without escaping noise

describe('author patterns run on RE2 (SEC-IN-2)', () => {
    it('match anywhere, like RegExp.test, including Ethiopic ranges', () => {
        expect(compilePattern('^[A-Z]{3}[0-9]{4}$')?.('WLT0001')).toBe(true);
        expect(compilePattern('[0-9]{4}')?.('No. 1234 here')).toBe(true);
        expect(compilePattern('^[ሀ-ፚ ]+$')?.('ሰላም ዓለም')).toBe(true);
        expect(compilePattern('^[ሀ-ፚ ]+$')?.('hello')).toBe(false);
    });

    it('accept the JavaScript way of writing an Ethiopic range, \\uXXXX', () => {
        const ethiopic = `^[${BS}u1200-${BS}u137F ]+$`;
        expect(toRe2Syntax(ethiopic)).toBe(`^[${BS}x{1200}-${BS}x{137F} ]+$`);
        expect(compilePattern(ethiopic)?.('ሰላም ዓለም')).toBe(true);
        expect(compilePattern(`${BS}u{1F600}`)).not.toBeNull();
        // an escaped backslash followed by "u1200" stays literal text
        expect(toRe2Syntax(`${BS}${BS}u1200`)).toBe(`${BS}${BS}u1200`);
    });

    it('stay fast on a pattern that freezes a backtracking engine', () => {
        const evil = compilePattern('(a+)+$');
        const started = performance.now();
        // No match (the input ends in "!"): a backtracking engine tries every split of the a's before saying so.
        expect(evil?.(`${'a'.repeat(MAX_INPUT_LENGTH - 1)}!`)).toBe(false);
        expect(performance.now() - started).toBeLessThan(1_000);
    });

    it('bound the work: pattern length, counted repetitions and input length', () => {
        expect(countedRepeats('[a-z]{10}[0-9]{2,5}x{3,}')).toBe(18);
        expect(countedRepeats(`${BS}{999}`)).toBe(0); // an escaped brace is a literal
        expect(explainPattern('a'.repeat(201))).toMatch(/at most 200 characters/);
        expect(explainPattern('[a-z]{999}')).toMatch(/at most 100/);
        expect(compilePattern('[a-z]{999}')).toBeNull();
        // longer input than the bound never matches (validation then reports the format)
        expect(compilePattern('a')?.('a'.repeat(MAX_INPUT_LENGTH + 1))).toBe(false);
    });

    it('treat invalid and unsupported patterns (look-around, back-references) as unusable, and say why', () => {
        expect(compilePattern('(a')).toBeNull();
        expect(compilePattern('(?=a)b')).toBeNull();
        expect(compilePattern(`(a)${BS}1`)).toBeNull();
        expect(explainPattern('(?=a)b')).toMatch(/look-ahead, look-behind or back-references/);
        expect(explainPattern('^[A-Z]{3}$')).toBeNull();
    });

    it('the regex condition matches through RE2 and never matches with an unusable pattern', () => {
        const regex = (value: string) => [{ field: 'code', operator: 'regex', value }] as VisibilityCondition[];
        expect(evaluateAll(regex('^WLT'), { code: 'WLT/0001' })).toBe(true);
        expect(evaluateAll(regex('(?=x)'), { code: 'x' })).toBe(false);
    });
});
