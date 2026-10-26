/**
 * The engine's own words (task 0.17d, ADR-0036): the designer's, renderer's, viewer's and print's texts and core's default
 * validation messages, from the catalogues in `messages/<area>/<language>.json` (`pnpm i18n:check` keeps `am` and `en`
 * complete). They are resolved here, not by the app's next-intl, so the same words reach the browser, the API's 422 and the
 * PDF worker. Keys are typed: a mistyped key fails typecheck. Texts are ICU messages (`{count, plural, one {…} other {…}}`).
 */
import { IntlMessageFormat } from 'intl-messageformat';

import { fallbackChain, textIn, type I18nText } from '@itrms/schemas';

import coreAm from '../../messages/core/am.json';
import coreEn from '../../messages/core/en.json';
import coreWal from '../../messages/core/wal-Latn.json';
import designerAm from '../../messages/designer/am.json';
import designerEn from '../../messages/designer/en.json';
import designerWal from '../../messages/designer/wal-Latn.json';
import paletteAm from '../../messages/palette/am.json';
import paletteEn from '../../messages/palette/en.json';
import paletteWal from '../../messages/palette/wal-Latn.json';
import rendererAm from '../../messages/renderer/am.json';
import rendererEn from '../../messages/renderer/en.json';
import rendererWal from '../../messages/renderer/wal-Latn.json';
import settingsAm from '../../messages/settings/am.json';
import settingsEn from '../../messages/settings/en.json';
import settingsWal from '../../messages/settings/wal-Latn.json';
import viewerAm from '../../messages/viewer/am.json';
import viewerEn from '../../messages/viewer/en.json';
import viewerWal from '../../messages/viewer/wal-Latn.json';

/** A key of the engine's catalogues (the English catalogue is the list). */
export type EngineMessageKey =
    | keyof typeof coreEn
    | keyof typeof designerEn
    | keyof typeof paletteEn
    | keyof typeof rendererEn
    | keyof typeof settingsEn
    | keyof typeof viewerEn;
export type EngineValues = Readonly<Record<string, string | number>>;
/** A key of the engine's catalogues, or a text in every language (an extension's own field type). Never a bare string. */
export type EngineWord = EngineMessageKey | I18nText;
export type EngineTranslate = (key: EngineMessageKey, values?: EngineValues) => string;

type Catalogue = Readonly<Record<string, string>>;
const merged = (...parts: object[]): Catalogue => Object.assign({}, ...parts) as Catalogue;

const CATALOGUES: Readonly<Record<string, Catalogue>> = {
    am: merged(coreAm, designerAm, paletteAm, rendererAm, settingsAm, viewerAm),
    en: merged(coreEn, designerEn, paletteEn, rendererEn, settingsEn, viewerEn),
    'wal-Latn': merged(coreWal, designerWal, paletteWal, rendererWal, settingsWal, viewerWal)
};
/** The locale a catalogue's plurals follow (Wolaytta's are English's: i18n-and-languages.md §1). */
const PLURALS_OF: Readonly<Record<string, string>> = { am: 'am', en: 'en', 'wal-Latn': 'en' };

const formats = new Map<string, IntlMessageFormat>();

function format(tag: string, key: string, pattern: string, values: EngineValues | undefined): string {
    if (!pattern.includes('{') && !pattern.includes("'")) return pattern;
    const id = `${tag} ${key}`;
    try {
        let message = formats.get(id);
        if (!message) {
            message = new IntlMessageFormat(pattern, PLURALS_OF[tag] ?? tag);
            formats.set(id, message);
        }
        const out = message.format<string>(values);
        return Array.isArray(out) ? out.join('') : String(out);
    } catch {
        // a text that does not format (a value missing, a broken pattern) shows as written rather than breaking a screen
        return pattern;
    }
}

/** One of the engine's words in a language, falling back `wal-Latn → am → en`. */
export function engineText(language: string, key: EngineMessageKey, values?: EngineValues): string {
    for (const tag of fallbackChain(language)) {
        const pattern = CATALOGUES[tag]?.[key];
        if (pattern) return format(tag, key, pattern, values);
    }
    return key;
}

/** The engine's words in one language. */
export function engineTranslator(language: string): EngineTranslate {
    return (key, values) => engineText(language, key, values);
}

/** A catalogue word or a text in every language, in a language. */
export function wordIn(language: string, word: EngineWord, values?: EngineValues): string {
    return typeof word === 'string' ? engineText(language, word, values) : textIn(word, language);
}
