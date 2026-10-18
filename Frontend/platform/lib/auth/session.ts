/**
 * Token session shared by the axios client and the auth store.
 *
 * Access tokens live in memory only. The refresh token is kept in sessionStorage (tab-scoped, cleared on close);
 * moving it to an httpOnly cookie set by the backend is the stronger option once the deployment allows it.
 */
import axios from 'axios';

const REFRESH_KEY = 'dfc.refresh';

export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
}

type Listener = (authenticated: boolean) => void;

let accessToken: string | null = null;
let inflight: Promise<string | null> | null = null;
const listeners = new Set<Listener>();

// A bare client (no interceptors) so refreshing can never recurse into itself.
const bare = () => axios.create({ baseURL: process.env.NEXT_PUBLIC_BACKEND_API, withCredentials: false });

const readRefresh = () => {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage.getItem(REFRESH_KEY);
    } catch {
        return null;
    }
};
const writeRefresh = (token: string | null) => {
    try {
        if (token) window.sessionStorage.setItem(REFRESH_KEY, token);
        else window.sessionStorage.removeItem(REFRESH_KEY);
    } catch {
        /* storage unavailable: session lasts until reload */
    }
};

export const session = {
    getAccessToken: () => accessToken,
    hasRefreshToken: () => !!readRefresh(),

    set(pair: TokenPair) {
        accessToken = pair.access_token;
        writeRefresh(pair.refresh_token);
        listeners.forEach((l) => l(true));
    },

    clear() {
        accessToken = null;
        writeRefresh(null);
        listeners.forEach((l) => l(false));
    },

    subscribe(listener: Listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** Exchange the refresh token for a new pair. Concurrent callers share one request (refresh tokens are single-use). */
    refresh(): Promise<string | null> {
        const token = readRefresh();
        if (!token) return Promise.resolve(null);
        if (!inflight) {
            inflight = bare()
                .post<TokenPair>('auth/refresh', { refresh_token: token })
                .then((res) => {
                    session.set(res.data);
                    return res.data.access_token;
                })
                .catch(() => {
                    session.clear();
                    return null;
                })
                .finally(() => {
                    inflight = null;
                });
        }
        return inflight;
    },

    async login(email: string, password: string) {
        const res = await bare().post<TokenPair>('auth/login', { email, password });
        session.set(res.data);
    },

    async logout() {
        const token = readRefresh();
        session.clear();
        if (token) await bare().post('auth/logout', { refresh_token: token }).catch(() => undefined);
    }
};
