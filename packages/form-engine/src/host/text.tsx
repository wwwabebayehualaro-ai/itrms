'use client';

/**
 * The engine's words on screen (task 0.17d): `useEngineText()` says them in the language of the nearest
 * `<EngineTextLanguage>` (a form drawn in its own language: the renderer, the builder's preview), else the host's
 * (the designer's and viewer's chrome). The words themselves are core's (`engineText`), so the API and print say the same.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { engineTranslator, wordIn, type EngineTranslate, type EngineValues, type EngineWord } from '../core/messages';
import { useScreenLanguage } from './FormsHost';

const LanguageContext = createContext<string | null>(null);

/** The language the engine's words take below it. */
export function EngineTextLanguage({ language, children }: { language: string; children: ReactNode }) {
    return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export interface EngineText {
    language: string;
    t: EngineTranslate;
    /** A catalogue key or a text in every language (an extension's own words). */
    word: (word: EngineWord, values?: EngineValues) => string;
}

export function useEngineText(): EngineText {
    const own = useContext(LanguageContext);
    const screen = useScreenLanguage();
    const language = own ?? screen;
    return useMemo(
        () => ({ language, t: engineTranslator(language), word: (w, values) => wordIn(language, w, values) }),
        [language]
    );
}
