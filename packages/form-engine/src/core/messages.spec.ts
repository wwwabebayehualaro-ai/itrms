// @vitest-environment node
// Task 0.17d: the engine's own words, typed keys, fallbacks and plurals.
import { describe, expect, it } from 'vitest';

import { engineText, engineTranslator, wordIn, type EngineMessageKey } from './messages';

describe('the engine words', () => {
    it('says a word in each language, falling back to Amharic then English', () => {
        expect(engineText('en', 'form-engine.core.print.yes')).toBe('Yes');
        expect(engineText('am', 'form-engine.core.print.yes')).toBe('አዎ');
        expect(engineText('wal-Latn', 'form-engine.core.print.yes')).toBe('አዎ');
        expect(engineText('om', 'form-engine.core.print.yes')).toBe('አዎ');
        expect(engineTranslator('en')('form-engine.core.print.rowNumber')).toBe('No.');
    });

    it('takes a text in every language as a word too', () => {
        expect(wordIn('en', { am: 'ሀ', en: 'A' })).toBe('A');
        expect(wordIn('om', { am: 'ሀ', en: 'A' })).toBe('ሀ');
        expect(wordIn('am', 'form-engine.core.print.no')).toBe('አይደለም');
    });

    it('formats values and plurals in each language', () => {
        const rows = (language: string, count: number) =>
            engineText(language, 'form-engine.core.validation.minItems', { label: 'Lines', count });
        expect(rows('en', 1)).toBe('Lines: at least 1 row required');
        expect(rows('en', 3)).toBe('Lines: at least 3 rows required');
        expect(rows('am', 3)).toBe('Lines፦ ቢያንስ 3 ረድፍ ያስፈልጋል');
        expect(engineText('en', 'form-engine.core.validation.min', { min: '1000' })).toBe('Must be at least 1000');
    });

    it('refuses a key the catalogues do not have at typecheck', () => {
        // @ts-expect-error: not a key of the engine's catalogues
        expect(engineText('en', 'form-engine.core.print.yess')).toBe('form-engine.core.print.yess');
        // @ts-expect-error: a bare string is not a word
        const word: EngineMessageKey = 'Yes';
        expect(word).toBe('Yes');
    });
});
