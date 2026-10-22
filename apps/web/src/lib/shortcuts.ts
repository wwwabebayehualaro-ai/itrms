'use client';
/**
 * Favourites (pinned menu items) and recently opened pages, per person, in this browser. They move to the server with the
 * user preferences (task 0.13), so they follow the person between PCs (navigation-and-menus.md §4). A storage the browser
 * refuses keeps them for the page's life only.
 */
import { create } from 'zustand';

export interface Recent {
    /** the menu item's key */
    key: string;
    at: number;
}

interface Stored {
    favourites: string[];
    recents: Recent[];
}

interface Shortcuts extends Stored {
    owner: string | null;
    /** Loads the person's shortcuts (a new person never sees another's). */
    load: (userId: string) => void;
    toggleFavourite: (key: string) => void;
    visit: (key: string) => void;
}

const MAX_RECENTS = 20;
const storageKey = (userId: string) => `itrms.shortcuts.${userId}`;

function read(userId: string): Stored {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '{}') as Partial<Stored>;
        return {
            favourites: Array.isArray(parsed.favourites) ? parsed.favourites.filter((k) => typeof k === 'string') : [],
            recents: Array.isArray(parsed.recents)
                ? parsed.recents.filter((r) => typeof r?.key === 'string' && typeof r.at === 'number')
                : []
        };
    } catch {
        return { favourites: [], recents: [] };
    }
}

function save(userId: string | null, stored: Stored) {
    if (!userId) return;
    try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(stored));
    } catch {
        /* storage refused */
    }
}

export const useShortcuts = create<Shortcuts>()((set, get) => ({
    owner: null,
    favourites: [],
    recents: [],
    load: (userId) => {
        if (get().owner !== userId) set({ owner: userId, ...read(userId) });
    },
    toggleFavourite: (key) => {
        const { owner, favourites, recents } = get();
        const next = favourites.includes(key) ? favourites.filter((k) => k !== key) : [...favourites, key];
        save(owner, { favourites: next, recents });
        set({ favourites: next });
    },
    visit: (key) => {
        const { owner, favourites, recents } = get();
        if (recents[0]?.key === key) return;
        const next = [{ key, at: Date.now() }, ...recents.filter((r) => r.key !== key)].slice(0, MAX_RECENTS);
        save(owner, { favourites, recents: next });
        set({ recents: next });
    }
}));
