/**
 * The BFF's wiring for the route handlers: configuration, the session store, the realm's keys, the session cookies and
 * problem responses. Server only: nothing here may be imported by a page or a client component (dependency-cruiser).
 */
import { createHash, randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';
import { ResponseBodyError } from 'openid-client';

import { CSRF_COOKIE, LOGIN_COOKIE, SESSION_COOKIE } from '@/lib/auth/cookies';
import am from '../../messages/am.json';
import en from '../../messages/en.json';
import { loadBffConfig, type BffConfig } from './config';
import { oidc, refresh } from './oidc';
import { SessionStore, valkeyKeyValue, type SessionRecord } from './session-store';

interface Runtime {
    config: BffConfig;
    store: SessionStore;
    realmKeys?: JWTVerifyGetKey;
}

// kept on globalThis: the dev server re-evaluates modules, and each evaluation would open another Valkey connection
const holder = globalThis as typeof globalThis & { __itrmsBff?: Runtime };

export function bff(): Runtime {
    if (!holder.__itrmsBff) {
        const config = loadBffConfig();
        const redis = new Redis(config.SESSION_VALKEY_URL, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
        holder.__itrmsBff = { config, store: new SessionStore(valkeyKeyValue(redis), config.keyring) };
    }
    return holder.__itrmsBff;
}

/** The realm's signing keys (for logout tokens), from its discovery document. */
export async function realmKeys(): Promise<JWTVerifyGetKey> {
    const runtime = bff();
    if (!runtime.realmKeys) {
        const jwksUri = (await oidc(runtime.config)).serverMetadata().jwks_uri;
        if (!jwksUri) throw new Error('the realm publishes no jwks_uri');
        runtime.realmKeys = createRemoteJWKSet(new URL(jwksUri));
    }
    return runtime.realmKeys;
}

/** 128 random bits, base64url (SEC-SE-1, SEC-CR-5). */
export const newSessionId = () => randomBytes(16).toString('base64url');
export const newCsrfToken = () => randomBytes(32).toString('base64url');
const SESSION_ID = /^[A-Za-z0-9_-]{22}$/;

export interface Session {
    id: string;
    record: SessionRecord;
}

/** The session the request's cookie names, its idle timeout restarted; undefined when there is none. */
export async function currentSession(request: NextRequest): Promise<Session | undefined> {
    const id = request.cookies.get(SESSION_COOKIE)?.value;
    if (!id || !SESSION_ID.test(id)) return undefined;
    const { store } = bff();
    const record = await store.get(id);
    if (!record || !(await store.touch(id, record))) return undefined;
    return { id, record };
}

/** Keycloak could not be asked (down, slow, rate-limited): the session stays, the request answers 503. */
export class KeycloakUnavailableError extends Error {
    constructor(cause: unknown) {
        super('Keycloak did not answer the refresh', { cause });
        this.name = 'KeycloakUnavailableError';
    }
}

/** Longer than a refresh may take (openid-client's timeout is set to REFRESH_TIMEOUT_SECONDS, oidc.ts). */
const REFRESH_LOCK_SECONDS = 20;
const lockOf = (id: string) => `refresh:${createHash('sha256').update(id).digest('base64url')}`;

/**
 * A session whose access token is good for at least 30 more seconds, refreshed once across concurrent requests:
 * undefined when the session is over (Keycloak refused the refresh token: revoked, reused, the Keycloak session ended);
 * KeycloakUnavailableError when Keycloak could not be asked, which never ends the session.
 */
export async function withFreshToken(session: Session): Promise<Session | undefined> {
    const fresh = (r: SessionRecord) => r.accessExpiresAt - Date.now() > 30_000;
    if (fresh(session.record)) return session;
    const { config, store } = bff();
    const lock = lockOf(session.id);
    if (await store.claim(lock, REFRESH_LOCK_SECONDS)) {
        try {
            // read again under the lock: another request may have refreshed it a moment ago
            const current = await store.get(session.id);
            if (!current) return undefined;
            if (fresh(current)) return { id: session.id, record: current };
            if (!current.refreshToken) return undefined;
            let tokens;
            try {
                tokens = await refresh(await oidc(config), current.refreshToken);
            } catch (e) {
                if (e instanceof ResponseBodyError && e.error === 'invalid_grant') {
                    await store.delete(session.id);
                    return undefined;
                }
                throw new KeycloakUnavailableError(e);
            }
            const record: SessionRecord = {
                ...current,
                accessToken: tokens.accessToken,
                accessExpiresAt: tokens.accessExpiresAt,
                refreshToken: tokens.refreshToken ?? current.refreshToken,
                idToken: tokens.idToken ?? current.idToken
            };
            // ended meanwhile (sign-out, back-channel logout): it stays ended
            return (await store.update(session.id, record)) ? { id: session.id, record } : undefined;
        } finally {
            await store.release(lock);
        }
    }
    // another request is refreshing this session: wait for its result, as long as its lock may last
    for (let i = 0; i < REFRESH_LOCK_SECONDS * 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const record = await store.get(session.id);
        if (!record) return undefined;
        if (fresh(record)) return { id: session.id, record };
    }
    throw new KeycloakUnavailableError(new Error('the refresh in progress did not finish'));
}

/**
 * Runs `fn` while no request refreshes the session (a unit switch copies the refresh token, which a refresh in flight
 * would rotate away from the copy).
 */
export async function withRefreshLock<T>(session: Session, fn: () => Promise<T>): Promise<T> {
    const { store } = bff();
    const lock = lockOf(session.id);
    for (let i = 0; !(await store.claim(lock, REFRESH_LOCK_SECONDS)); i++) {
        if (i >= REFRESH_LOCK_SECONDS * 10) throw new KeycloakUnavailableError(new Error('a refresh is in progress'));
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
        return await fn();
    } finally {
        await store.release(lock);
    }
}

const cookieOptions = { secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookies(response: NextResponse, session: Session): NextResponse {
    response.cookies.set(SESSION_COOKIE, session.id, { ...cookieOptions, httpOnly: true });
    // readable by the page, which sends it back (double submit); useless to another site, which can't read it
    response.cookies.set(CSRF_COOKIE, session.record.csrf, { ...cookieOptions, httpOnly: false, sameSite: 'strict' });
    return response;
}

export function clearSessionCookies(response: NextResponse): NextResponse {
    for (const name of [SESSION_COOKIE, CSRF_COOKIE, LOGIN_COOKIE])
        response.cookies.set(name, '', { ...cookieOptions, httpOnly: true, maxAge: 0 });
    return response;
}

export type ProblemCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_request' | 'unavailable';

/** An RFC 9457 problem in the API's shape, for refusals the BFF makes itself; the title in the person's language. */
export function problem(request: NextRequest, status: number, code: ProblemCode): NextResponse {
    const english = /^en/i.test(request.headers.get('accept-language') ?? '');
    const title = (english ? en : am)[`shell.errors.${code}`];
    return NextResponse.json(
        { type: `urn:itrms:problem:${code}`, title, status, code },
        { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } }
    );
}

/** A path on this app to come back to after sign-in: relative, never another site (`//evil.example`, `/\evil`). */
export function safeReturnPath(value: string | null | undefined): string {
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
    if (/[\u0000-\u001f]/.test(value) || value.startsWith('/auth/')) return '/';
    return value;
}
