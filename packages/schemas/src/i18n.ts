/**
 * Text of data in every language of an installation (i18n-and-languages.md): Amharic and English are required; other
 * languages are the installation's own (Wolaytta `wal-Latn` for Wolaita, Afaan Oromo `om`, Tigrinya `ti`, …), keyed by
 * their BCP 47 tag. A missing one falls back along the installation's language list (i18n-and-languages.md §6).
 */
import { z } from 'zod';

/** A BCP 47 tag as ITRMS uses them: a language, then optional subtags (`am`, `wal-Latn`, `om`). */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export const i18nTextSchema = z
    .object({ am: z.string().min(1), en: z.string().min(1) })
    .catchall(z.string().min(1))
    .superRefine((text, ctx) => {
        for (const tag of Object.keys(text))
            if (!LANGUAGE_TAG.test(tag))
                ctx.addIssue({ code: 'custom', path: [tag], message: 'is not a language tag' });
    });

export type I18nText = z.infer<typeof i18nTextSchema>;

/** The languages ITRMS ships catalogues for: Amharic first, English, Wolaytta (Latin script); a region adds others. */
export const SHIPPED_LANGUAGES = ['am', 'en', 'wal-Latn'] as const;

/** Every language a region may turn on (its catalogues shipped or added later): the one list the code reads. */
export const INSTALLABLE_LANGUAGES = ['am', 'en', 'wal-Latn', 'om', 'ti'] as const;
export type InstallableLanguage = (typeof INSTALLABLE_LANGUAGES)[number];

/** Each language named in itself (an endonym, the same in every language), for language menus. */
export const LANGUAGE_ENDONYMS: Readonly<Record<InstallableLanguage, string>> = {
    am: 'አማርኛ',
    en: 'English',
    'wal-Latn': 'Wolayttatto',
    om: 'Afaan Oromoo',
    ti: 'ትግርኛ'
};

/**
 * The order a missing text falls back in (i18n-and-languages.md §6): the language asked for, then Amharic, the default,
 * then English. `wal-Latn → am → en`; `en → am`.
 */
export function fallbackChain(language: string): string[] {
    return [...new Set([language, 'am', 'en'])];
}

/** A data name in a language, with the fallback chain (never empty: `am` and `en` are required). */
export function textIn(text: I18nText, language: string): string {
    for (const tag of fallbackChain(language)) {
        const value = text[tag];
        if (value) return value;
    }
    return text.am;
}

/** An I18nText with a language set or changed (a new object). */
export const withText = (text: I18nText, language: string, value: string): I18nText => ({ ...text, [language]: value });
