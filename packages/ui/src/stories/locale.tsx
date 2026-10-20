/**
 * Story helpers (not exported from the package): the language chosen in the Storybook toolbar, and text for it. Story text
 * is fixture text; the product's own words live in message catalogues (task 0.13).
 */
import * as React from 'react';

export const STORY_LOCALES = ['am', 'en', 'wal-Latn'] as const;
export type StoryLocale = (typeof STORY_LOCALES)[number];

const LocaleContext = React.createContext<StoryLocale>('am');

export function StoryLocaleProvider({ locale, children }: { locale: StoryLocale; children: React.ReactNode }) {
    return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useStoryLocale = () => React.useContext(LocaleContext);

/** One piece of story text in each language. Wolaytta falls back to English until its catalogue exists. */
export interface StoryText {
    am: string;
    en: string;
    wal?: string;
}

export function useText(text: StoryText): string {
    const locale = useStoryLocale();
    if (locale === 'am') return text.am;
    if (locale === 'wal-Latn') return text.wal ?? text.en;
    return text.en;
}

/** Story text as an element: `<T text={TEXT.save} />`. Where a prop needs a string, use `useText` in a named component. */
export function T({ text }: { text: StoryText }) {
    return <>{useText(text)}</>;
}

/** For lists of texts: `useTexts(OPTIONS)` returns the active language of each. */
export function useTexts<T extends Record<string, StoryText>>(texts: T): Record<keyof T, string> {
    const locale = useStoryLocale();
    const pick = (t: StoryText) => (locale === 'am' ? t.am : locale === 'wal-Latn' ? (t.wal ?? t.en) : t.en);
    return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, pick(t)])) as Record<keyof T, string>;
}
