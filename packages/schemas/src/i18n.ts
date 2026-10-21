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
