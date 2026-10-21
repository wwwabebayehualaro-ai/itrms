'use client';
import { create } from 'zustand';
import client from '../api/client';
import { session } from './session';

export interface AuthUser {
    id: string;
    username: string;
    full_name: string | null;
    /** The roles held in the active unit. */
    roles: string[];
    /** Effective "resource:action" permissions in the active unit: hints for hiding UI; the API decides. */
    permissions: string[];
    activeUnit: { id: string; code: string; name: Record<string, string> };
}

interface Workspace {
    user: { id: string; username?: string; displayName?: string | null };
    activeUnit: { id: string; code: string; name: Record<string, string> };
    roles: string[];
    permissions: string[];
}

interface AuthState {
    user: AuthUser | null;
    status: 'loading' | 'authenticated' | 'anonymous';
    /** Asks the API who is signed in, through the BFF (the session cookie travels by itself). */
    hydrate: () => Promise<void>;
    logout: () => void;
}

const fetchProfile = async (): Promise<AuthUser> => {
    // skipAuth: a missing session is an answer here, not a reason to leave the page
    const { user, activeUnit, roles, permissions } = (
        await client.get<Workspace>('v1/me/workspace', { skipAuth: true })
    ).data;
    return {
        id: user.id,
        username: user.username ?? '',
        full_name: user.displayName ?? null,
        roles,
        permissions,
        activeUnit: { id: activeUnit.id, code: activeUnit.code, name: activeUnit.name }
    };
};

export const useAuthStore = create<AuthState>()((set) => ({
    user: null,
    status: 'loading',

    hydrate: async () => {
        try {
            set({ user: await fetchProfile(), status: 'authenticated' });
        } catch {
            set({ user: null, status: 'anonymous' });
        }
    },

    // the page leaves for Keycloak's end-session endpoint; the store stays as it is, because an 'anonymous' status would
    // send the AuthGate to sign-in and cancel the sign-out on its way
    logout: () => session.signOut()
}));
