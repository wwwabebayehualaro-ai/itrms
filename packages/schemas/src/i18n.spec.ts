import { describe, expect, it } from 'vitest';

import { i18nTextSchema } from './i18n';

describe('I18nText', () => {
    it('requires Amharic and English and takes any other language of an installation', () => {
        expect(
            i18nTextSchema.safeParse({ am: 'መንጃ ፈቃድ', en: 'Driving licence', 'wal-Latn': 'x', om: 'y' }).success
        ).toBe(true);
        expect(i18nTextSchema.safeParse({ en: 'Driving licence' }).success).toBe(false);
        expect(i18nTextSchema.safeParse({ am: 'ሀ', en: 'a', 'not a tag': 'x' }).success).toBe(false);
        expect(i18nTextSchema.safeParse({ am: 'ሀ', en: 'a', ti: '' }).success).toBe(false);
    });
});
