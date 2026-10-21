/**
 * Keycloak sends the browser back here with a code. The BFF checks state, PKCE and the ID token's nonce, exchanges the
 * code, and starts a new session: a new id every sign-in, and a session the browser had before ends (SEC-SE-3).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { finishSignIn, oidc, type LoginTransaction } from '@/bff/oidc';
import { bff, currentSession, newCsrfToken, newSessionId, setSessionCookies } from '@/bff/runtime';
import { open } from '@/bff/seal';
import { LOGIN_COOKIE } from '@/lib/auth/cookies';

export async function GET(request: NextRequest) {
    const { config, store } = bff();
    // only the sign-in in progress ends: a link to this URL from another site must not sign anyone out
    const failed = () => {
        const response = NextResponse.redirect(new URL('/auth/error', config.APP_ORIGIN), 303);
        response.cookies.set(LOGIN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
        return response;
    };

    const sealed = request.cookies.get(LOGIN_COOKIE)?.value;
    const plain = sealed ? open(config.keyring, sealed, LOGIN_COOKIE) : undefined;
    if (!plain) return failed();
    const transaction = JSON.parse(plain) as LoginTransaction;

    let tokens;
    try {
        // the URL Keycloak redirected to, as the browser saw it (not the address the server listens on)
        tokens = await finishSignIn(
            await oidc(config),
            new URL(`/auth/callback${request.nextUrl.search}`, config.APP_ORIGIN),
            transaction
        );
    } catch {
        return failed();
    }
    if (!tokens.sub) return failed();

    const previous = await currentSession(request);
    if (previous) await store.delete(previous.id);
    const session = {
        id: newSessionId(),
        record: {
            sub: tokens.sub,
            sid: tokens.sid,
            // a step-up keeps the unit the person was acting for
            activeUnit: previous?.record.sub === tokens.sub ? previous.record.activeUnit : undefined,
            csrf: newCsrfToken(),
            createdAt: Date.now(),
            accessToken: tokens.accessToken,
            accessExpiresAt: tokens.accessExpiresAt,
            refreshToken: tokens.refreshToken,
            idToken: tokens.idToken
        }
    };
    await store.put(session.id, session.record);

    const response = setSessionCookies(
        NextResponse.redirect(new URL(transaction.returnTo, config.APP_ORIGIN), 303),
        session
    );
    response.cookies.set(LOGIN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    response.headers.set('cache-control', 'no-store');
    return response;
}
