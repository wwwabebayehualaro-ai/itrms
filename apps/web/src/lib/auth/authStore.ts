'use client';
import { create } from 'zustand';
import axiosInstance from '../api/client';
import { session } from './session';

export interface AuthUser {
    id: string;
    tenant_id: string;
    email: string;
    full_name: string | null;
    roles: string[];
    /** Effective "resource:action" permissions of the user (from GET auth/me). */
    permissions?: string[];
}

interface AuthState {
    user: AuthUser | null;
    status: 'loading' | 'authenticated' | 'anonymous';
    /** Restore the session on page load (refresh token -> access token -> profile). */
    hydrate: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const fetchProfile = async () => (await axiosInstance.get<AuthUser>('auth/me')).data;

export const useAuthStore = create<AuthState>()((set) => ({
    user: null,
    status: 'loading',

    hydrate: async () => {
        if (!session.getAccessToken() && !(await session.refresh())) {
            set({ user: null, status: 'anonymous' });
            return;
        }
        try {
            set({ user: await fetchProfile(), status: 'authenticated' });
        } catch {
            session.clear();
            set({ user: null, status: 'anonymous' });
        }
    },

    login: async (email, password) => {
        await session.login(email, password);
        set({ user: await fetchProfile(), status: 'authenticated' });
    },

    logout: async () => {
        await session.logout();
        set({ user: null, status: 'anonymous' });
    }
}));

// Another tab/expired refresh cleared the tokens: reflect it immediately.
session.subscribe((authenticated) => {
    if (!authenticated) useAuthStore.setState({ user: null, status: 'anonymous' });
});
