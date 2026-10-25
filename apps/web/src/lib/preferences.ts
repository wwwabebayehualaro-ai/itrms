'use client';
/**
 * The person's preferences (task 0.13): language, calendar, favourites and recently opened pages. They live on the server
 * (`PUT /api/v1/me/preferences`), so they follow the person between PCs; the workspace brings them at sign-in. The
 * language is next-intl's locale: the `itrms_lang` cookie lets the server render in it, and changing it renders again.
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { create } from 'zustand';

import { INSTALLABLE_LANGUAGES, LANGUAGE_ENDONYMS, SHIPPED_LANGUAGES } from '@itrms/schemas';

import { LANGUAGE_COOKIE } from './auth/cookies';
import client from './api/client';

export const LANGUAGES = SHIPPED_LANGUAGES;
export type Language = (typeof LANGUAGES)[number];
export const CALENDARS = ['ethiopian', 'gregorian'] as const;
export type Calendar = (typeof CALENDARS)[number];

/** Each language named in itself (an endonym, the same in every language), for the language menu. */
export const LANGUAGE_NAMES: Record<Language, string> = LANGUAGE_ENDONYMS;

/** The installation's languages (`i18n.languages` in the workspace settings) that the shell can show. */
export function availableLanguages(setting: unknown): Language[] {
    const listed = Array.isArray(setting) ? setting : ['am', 'en'];
    return LANGUAGES.filter((l) => listed.includes(l));
}

/**
 * The languages a form's texts are written in: Amharic and English first, then the installation's other languages
 * (`i18n.languages`), including those the shell has no catalogue for (om, ti); unknown tags are dropped.
 */
export function formLanguages(setting: unknown): string[] {
    const listed: unknown[] = Array.isArray(setting) ? setting : [];
    const known = new Set<string>(INSTALLABLE_LANGUAGES);
    return [...new Set(['am', 'en', ...listed.filter((l): l is string => typeof l === 'string' && known.has(l))])];
}

export interface Recent {
    /** the menu item's key */
    key: string;
    at: number;
}

export interface StoredPreferences {
    language?: string;
    calendar?: Calendar;
    favourites?: string[];
    recents?: Recent[];
}

const MAX_RECENTS = 20;
/** A change the person made is saved this long after the last one; the pages opened, at most once in this time. */
const SAVE_DELAY = 800;
const RECENTS_DELAY = 60_000;

interface Preferences {
    /** the server's preferences have arrived (until then a change stays on this page: it would overwrite them) */
    loaded: boolean;
    calendar: Calendar;
    favourites: string[];
    recents: Recent[];
    /** the person's (from the workspace) */
    load: (stored: StoredPreferences) => void;
    setCalendar: (calendar: Calendar) => void;
    toggleFavourite: (key: string) => void;
    visit: (key: string) => void;
}

/**
 * Sends the keys changed (`PATCH /api/v1/me/preferences`): the server keeps the others, so a page visit in one tab never
 * drops a favourite pinned in another.
 */
let saver: (changes: StoredPreferences) => Promise<unknown> = (changes) => client.patch('v1/me/preferences', changes);
/** Tests replace the server. */
export const setPreferencesSaver = (fn: typeof saver) => (saver = fn);

type Saved = 'calendar' | 'favourites' | 'recents';
const pending = new Set<Saved>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** The changed keys as they are now (read when sent, never when scheduled). */
function takePending(): StoredPreferences {
    const state = usePreferences.getState();
    const changes: StoredPreferences = {};
    for (const key of pending) Object.assign(changes, { [key]: state[key] });
    pending.clear();
    clearTimeout(timer);
    timer = undefined;
    return changes;
}

function schedule(key: Saved) {
    if (!usePreferences.getState().loaded) return;
    pending.add(key);
    const onlyRecents = [...pending].every((k) => k === 'recents');
    // the pages opened wait for the running timer (a minute at most); a change the person made restarts a short one
    if (onlyRecents && timer) return;
    clearTimeout(timer);
    timer = setTimeout(
        () => void saver(takePending()).catch(() => undefined),
        onlyRecents ? RECENTS_DELAY : SAVE_DELAY
    );
}

export const usePreferences = create<Preferences>()((set, get) => ({
    loaded: false,
    calendar: 'ethiopian',
    favourites: [],
    recents: [],
    load: (stored) => {
        // what this page did before is replaced by the person's own
        pending.clear();
        clearTimeout(timer);
        timer = undefined;
        set({
            loaded: true,
            calendar: stored.calendar ?? 'ethiopian',
            favourites: stored.favourites ?? [],
            recents: stored.recents ?? []
        });
    },
    setCalendar: (calendar) => {
        set({ calendar });
        schedule('calendar');
    },
    toggleFavourite: (key) => {
        const { favourites } = get();
        set({ favourites: favourites.includes(key) ? favourites.filter((k) => k !== key) : [...favourites, key] });
        schedule('favourites');
    },
    visit: (key) => {
        const { recents } = get();
        if (recents[0]?.key === key) return;
        set({ recents: [{ key, at: Date.now() }, ...recents.filter((r) => r.key !== key)].slice(0, MAX_RECENTS) });
        schedule('recents');
    }
}));

/** The cookie the server renders the language from (a year; the server's preference is the lasting one). */
export function setLanguageCookie(language: string) {
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

/** Changes the person's language: saved on the server, then the page renders again in it. */
export function useSetLanguage() {
    const router = useRouter();
    return useCallback(
        async (language: Language) => {
            setLanguageCookie(language);
            // now, with anything still waiting: the page is about to render again
            await saver({ ...takePending(), language }).catch(() => undefined);
            router.refresh();
        },
        [router]
    );
}

type Text = { am: string; en: string } & Partial<Record<string, string>>;

/**
 * The shell's words (next-intl, the merged catalogues) and a data text (I18nText) in the person's language; a language
 * without the text falls back to Amharic, then English (i18n-and-languages.md §6).
 */
export function useText() {
    const language = useLocale();
    const translate = useTranslations();
    return {
        language,
        t: (key: string, values?: Record<string, string>) => translate(key as never, values as never),
        text: (value: Text) => value[language] ?? value.am ?? value.en
    };
}
