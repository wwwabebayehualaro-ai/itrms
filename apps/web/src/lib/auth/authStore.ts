'use client';
import { create } from 'zustand';
import client from '../api/client';
import type { StoredPreferences } from '../preferences';
import { session } from './session';

type Text = { am: string; en: string } & Partial<Record<string, string>>;

export interface MenuLink {
    key: string;
    label: Text;
    route: string;
}

export interface MenuItem extends MenuLink {
    icon: string;
    quickActions: MenuLink[];
}

export interface MenuGroup {
    key: string;
    label: Text;
    items: MenuItem[];
}

/** `GET /api/v1/me/workspace` (ADR-0028): who, where, what they may do there, and the menu computed for it. */
export interface Workspace {
    user: { id: string; username?: string; displayName?: string | null };
    activeUnit: { id: string; code: string; name: Text; services: string[]; capabilities: string[] };
    units: { id: string; code: string; name: Text; roles: string[] }[];
    roles: string[];
    permissions: string[];
    menu: MenuGroup[];
    settings: Record<string, unknown>;
    /** The names of the roles in `roles` and `units[].roles`: a role key is never shown to a person. */
    roleLabels: Record<string, Text>;
    /** The person's own, saved on the server (task 0.13). */
    preferences: StoredPreferences;
}

/** No role names yet: one object for every caller, so a store selector returns the same value each time. */
export const NO_LABELS: Readonly<Record<string, Text>> = Object.freeze({});

export interface AuthUser {
    id: string;
    username: string;
    full_name: string | null;
    /** The roles held in the active unit. */
    roles: string[];
    /** Effective "resource:action" permissions in the active unit: hints for hiding UI; the API decides. */
    permissions: string[];
    activeUnit: { id: string; code: string; name: Text };
}

interface AuthState {
    user: AuthUser | null;
    workspace: Workspace | null;
    status: 'loading' | 'authenticated' | 'anonymous';
    /** Asks the API who is signed in, through the BFF (the session cookie travels by itself). */
    hydrate: () => Promise<void>;
    /** Acts for another of the person's units: a new session id, a new scope, a new menu (SEC-SE-3). */
    switchUnit: (unitId: string) => Promise<void>;
    logout: () => void;
}

const userOf = (w: Workspace): AuthUser => ({
    id: w.user.id,
    username: w.user.username ?? '',
    full_name: w.user.displayName ?? null,
    roles: w.roles,
    permissions: w.permissions,
    activeUnit: { id: w.activeUnit.id, code: w.activeUnit.code, name: w.activeUnit.name }
});

let sessionChannel: BroadcastChannel | null | undefined;
/** The tabs of this browser share one BFF session: they tell each other when it changes. */
function channel(): BroadcastChannel | null {
    if (sessionChannel === undefined)
        sessionChannel =
            typeof window !== 'undefined' && 'BroadcastChannel' in window
                ? new BroadcastChannel('itrms.session')
                : null;
    return sessionChannel;
}

export const useAuthStore = create<AuthState>()((set) => ({
    user: null,
    workspace: null,
    status: 'loading',

    hydrate: async () => {
        try {
            // skipAuth: a missing session is an answer here, not a reason to leave the page
            const workspace = (await client.get<Workspace>('v1/me/workspace', { skipAuth: true })).data;
            set({ workspace, user: userOf(workspace), status: 'authenticated' });
        } catch {
            set({ user: null, workspace: null, status: 'anonymous' });
        }
    },

    switchUnit: async (unitId) => {
        const workspace = await session.switchUnit<Workspace>(unitId);
        set({ workspace, user: userOf(workspace) });
        // the unit is the session's: every other tab of this browser now acts for it too, and must show it
        channel()?.postMessage({ type: 'unit-switched' });
    },

    // the page leaves for Keycloak's end-session endpoint; the store stays as it is, because an 'anonymous' status would
    // send the AuthGate to sign-in and cancel the sign-out on its way
    logout: () => session.signOut()
}));

// Another tab switched the unit: load the workspace there (a new menu; the QueryProvider drops the other unit's data).
channel()?.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
    if (event.data.type === 'unit-switched' && useAuthStore.getState().status === 'authenticated')
        void useAuthStore.getState().hydrate();
});
