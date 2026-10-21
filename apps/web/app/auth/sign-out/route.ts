/**
 * Sign-out (SEC-SE-4): the session record is deleted, the cookies cleared, and the BFF ends the Keycloak session itself
 * (server to server, so no token travels in a URL). The browser goes back to the app, which sends it to sign-in. A form
 * post from the app's own page only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { sameOrigin, tokenMatches } from '@/bff/csrf';
import { endKeycloakSession, endSessionUrl, oidc } from '@/bff/oidc';
import { bff, clearSessionCookies, currentSession, problem } from '@/bff/runtime';
import { CSRF_FIELD, CSRF_HEADER } from '@/lib/auth/cookies';

export async function POST(request: NextRequest) {
    const { config, store } = bff();
    if (!sameOrigin(request.headers, config.APP_ORIGIN)) return problem(request, 403, 'forbidden');

    const after = `${config.APP_ORIGIN}/`;
    const session = await currentSession(request);
    if (!session) return clearSessionCookies(NextResponse.redirect(after, 303));

    const form = await request.formData().catch(() => undefined);
    const field = form?.get(CSRF_FIELD);
    const sent = request.headers.get(CSRF_HEADER) ?? (typeof field === 'string' ? field : null);
    if (!tokenMatches(sent, session.record.csrf)) return problem(request, 403, 'forbidden');

    await store.delete(session.id);
    let target: string | URL = after;
    try {
        const configuration = await oidc(config);
        try {
            if (!session.record.refreshToken) throw new Error('no refresh token');
            await endKeycloakSession(configuration, config.OIDC_CLIENT_SECRET, session.record.refreshToken);
        } catch {
            // the server-to-server logout failed: send the browser to Keycloak's end-session page instead (it asks the
            // person to confirm, as no ID token is sent), so a shared office PC is never left signed in to Keycloak
            target = endSessionUrl(configuration, after);
        }
    } catch {
        // Keycloak unreachable altogether: the BFF session is gone; its single sign-on session ends at its idle timeout
    }
    const response = clearSessionCookies(NextResponse.redirect(target, 303));
    response.headers.set('cache-control', 'no-store');
    return response;
}
