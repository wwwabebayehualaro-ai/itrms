import { describe, expect, it } from 'vitest';

import { fallbackChain, textIn } from './i18n';
import { foldForSearch } from './search';

describe('search folding', () => {
    it('finds an Ethiopic name whichever homophone it was written with', () => {
        // ሐሰን / ሀሰን / ኀሠን, ዓለሙ / ኣለሙ, ፀሐይ / ጸሀይ
        expect(foldForSearch('ሐሰን')).toBe(foldForSearch('ሀሰን'));
        expect(foldForSearch('ኀሠን')).toBe(foldForSearch('ሀሰን'));
        expect(foldForSearch('ዓለሙ')).toBe(foldForSearch('ኣለሙ'));
        expect(foldForSearch('ፀሐይ')).toBe(foldForSearch('ጸሀይ'));
        expect(foldForSearch('በቀለ')).not.toBe(foldForSearch('ቀበለ'));
    });

    it("folds Wolaytta's glottal stop, case, diacritics and spaces", () => {
        const forms = ["Wolayta'a", 'Wolayta’a', 'WOLAYTAʼA', 'wolayta7a', '  wolayta‘a '];
        expect(new Set(forms.map(foldForSearch)).size).toBe(1);
        expect(foldForSearch('Bodïti   Town')).toBe('boditi town');
        // a 7 between digits is a number, not a glottal stop
        expect(foldForSearch('ETH 1774')).toBe('eth 1774');
    });
});

describe('I18nText', () => {
    it('falls back wal-Latn → am → en', () => {
        expect(fallbackChain('wal-Latn')).toEqual(['wal-Latn', 'am', 'en']);
        expect(fallbackChain('en')).toEqual(['en', 'am']);
        expect(textIn({ am: 'ቦዲቲ', en: 'Boditi' }, 'wal-Latn')).toBe('ቦዲቲ');
        expect(textIn({ am: 'ቦዲቲ', en: 'Boditi', 'wal-Latn': 'Bodditte' }, 'wal-Latn')).toBe('Bodditte');
        expect(textIn({ am: 'ቦዲቲ', en: 'Boditi' }, 'en')).toBe('Boditi');
    });
});
