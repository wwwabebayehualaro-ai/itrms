'use client';
/**
 * The person's display preferences: language and calendar. Kept in this browser only until the user preferences are stored
 * on the server with the i18n platform (task 0.13); a storage the browser refuses leaves the defaults (Amharic, the
 * Ethiopian calendar).
 */
import { create } from 'zustand';

import am from '../../messages/am.json';
import en from '../../messages/en.json';

export const LANGUAGES = ['am', 'en', 'wal-Latn'] as const;
export type Language = (typeof LANGUAGES)[number];
export const CALENDARS = ['ethiopian', 'gregorian'] as const;
export type Calendar = (typeof CALENDARS)[number];

/** Each language named in itself (an endonym, the same in every language), for the language menu. */
export const LANGUAGE_NAMES: Record<Language, string> = { am: 'አማርኛ', en: 'English', 'wal-Latn': 'Wolayttatto' };

const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    try {
        const value = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
        return allowed.find((a) => a === value) ?? fallback;
    } catch {
        return fallback;
    }
};
const write = (key: string, value: string) => {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        /* storage refused: the choice lasts until the page is reloaded */
    }
};

interface Preferences {
    language: Language;
    calendar: Calendar;
    setLanguage: (language: Language) => void;
    setCalendar: (calendar: Calendar) => void;
}

/** The installation's languages (`i18n.languages` in the workspace settings) that the shell can show. */
export function availableLanguages(setting: unknown): Language[] {
    const listed = Array.isArray(setting) ? setting : ['am', 'en'];
    return LANGUAGES.filter((l) => listed.includes(l));
}

export const usePreferences = create<Preferences>()((set) => ({
    language: read('itrms.language', LANGUAGES, 'am'),
    calendar: read('itrms.calendar', CALENDARS, 'ethiopian'),
    setLanguage: (language) => {
        write('itrms.language', language);
        document.documentElement.lang = language;
        set({ language });
    },
    setCalendar: (calendar) => {
        write('itrms.calendar', calendar);
        set({ calendar });
    }
}));

export type ShellKey = keyof typeof en & keyof typeof am;
type Text = { am: string; en: string } & Partial<Record<string, string>>;

/**
 * The shell's own words (`messages/*.json`) and a data text (I18nText) in the person's language; a language without the
 * text falls back to Amharic, the installation's default (i18n-and-languages.md §6).
 */
export function useText() {
    const language = usePreferences((s) => s.language);
    const catalogue: Record<string, string> = language === 'en' ? en : am;
    return {
        language,
        t: (key: ShellKey, values: Record<string, string> = {}) =>
            (catalogue[key] ?? am[key]).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`),
        text: (value: Text) => value[language] ?? value.am
    };
}

// the page's language from the start (screen readers pick their voice from it), not only after a change
if (typeof document !== 'undefined') document.documentElement.lang = usePreferences.getState().language;
