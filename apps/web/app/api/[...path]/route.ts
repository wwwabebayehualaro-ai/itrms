/**
 * The API proxy (ADR-0021): the browser calls `/api/v1/…` on the app's own origin; the BFF checks the session (and CSRF
 * for state-changing calls), refreshes the access token when needed, and calls the API with the bearer token and the
 * active unit. Only allow-listed headers pass either way: the browser's cookies never reach the API, and the API's
 * cookies (it sets none) never reach the browser.
 */
import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { isSafeMethod, sameOrigin, tokenMatches } from '@/bff/csrf';
import { apiRequestHeaders, apiTarget, browserResponseHeaders } from '@/bff/forward';
import { bff, clearSessionCookies, currentSession, problem, withFreshToken } from '@/bff/runtime';
import { CSRF_HEADER } from '@/lib/auth/cookies';

interface Context {
    params: Promise<{ path: string[] }>;
}

async function handle(request: NextRequest, context: Context) {
    const { config } = bff();
    const target = apiTarget(config.API_URL, (await context.params).path, request.nextUrl.search);
    if (!target) return problem(request, 404, 'not_found');

    const current = await currentSession(request);
    if (!current) return problem(request, 401, 'unauthenticated');
    const unsafe = !isSafeMethod(request.method);
    if (
        unsafe &&
        !(
            sameOrigin(request.headers, config.APP_ORIGIN) &&
            tokenMatches(request.headers.get(CSRF_HEADER), current.record.csrf)
        )
    )
        return problem(request, 403, 'forbidden');
    let session;
    try {
        session = await withFreshToken(current);
    } catch {
        // Keycloak could not be asked: the session stays, the person tries again
        return problem(request, 503, 'unavailable');
    }
    if (!session) return clearSessionCookies(problem(request, 401, 'unauthenticated'));

    let response: Response;
    try {
        response = await fetch(target, {
            method: request.method,
            headers: apiRequestHeaders(
                request.headers,
                session.record.accessToken,
                session.record.activeUnit,
                randomUUID()
            ),
            body: unsafe ? request.body : undefined,
            // a streamed request body (Node's fetch needs it said)
            duplex: 'half',
            redirect: 'manual',
            signal: AbortSignal.timeout(60_000)
        } as RequestInit & { duplex: 'half' });
    } catch {
        return problem(request, 503, 'unavailable');
    }
    return new NextResponse(response.body, {
        status: response.status,
        headers: browserResponseHeaders(response.headers)
    });
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
