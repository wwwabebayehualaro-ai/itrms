/**
 * Switching the unit the person acts for (the unit switcher, task 0.10b). The API decides whether they hold a role there;
 * if they do, the session gets the new unit under a new id and a new CSRF token (a privilege change, SEC-SE-3).
 */
import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { sameOrigin, tokenMatches } from '@/bff/csrf';
import { apiRequestHeaders, browserResponseHeaders } from '@/bff/forward';
import {
    bff,
    clearSessionCookies,
    currentSession,
    newCsrfToken,
    newSessionId,
    problem,
    setSessionCookies,
    withFreshToken,
    withRefreshLock
} from '@/bff/runtime';
import { CSRF_HEADER } from '@/lib/auth/cookies';

const body = z.strictObject({ unitId: z.uuid() });

export async function POST(request: NextRequest) {
    const { config, store } = bff();
    const current = await currentSession(request);
    if (!current) return problem(request, 401, 'unauthenticated');
    if (
        !sameOrigin(request.headers, config.APP_ORIGIN) ||
        !tokenMatches(request.headers.get(CSRF_HEADER), current.record.csrf)
    )
        return problem(request, 403, 'forbidden');
    const parsed = body.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return problem(request, 400, 'invalid_request');
    let session;
    try {
        session = await withFreshToken(current);
    } catch {
        return problem(request, 503, 'unavailable');
    }
    if (!session) return clearSessionCookies(problem(request, 401, 'unauthenticated'));
    const old = session;

    const asked = new Headers({ accept: 'application/json' });
    const language = request.headers.get('accept-language');
    if (language) asked.set('accept-language', language);
    let workspace: Response;
    try {
        workspace = await fetch(`${config.API_URL}/api/v1/me/workspace`, {
            headers: apiRequestHeaders(asked, old.record.accessToken, parsed.data.unitId, randomUUID()),
            signal: AbortSignal.timeout(30_000)
        });
    } catch {
        return problem(request, 503, 'unavailable');
    }
    // no role there (403) or not in their scope (404): the API's answer, and the session stays as it was
    if (!workspace.ok)
        return new NextResponse(workspace.body, {
            status: workspace.status,
            headers: browserResponseHeaders(workspace.headers)
        });

    const answer = new NextResponse(workspace.body, {
        status: 200,
        headers: browserResponseHeaders(workspace.headers)
    });
    try {
        // under the refresh lock, from the latest record: the copy must hold the refresh token Keycloak still accepts
        return await withRefreshLock(old, async () => {
            const latest = await store.get(old.id);
            if (!latest) return clearSessionCookies(problem(request, 401, 'unauthenticated'));
            const next = {
                id: newSessionId(),
                record: { ...latest, activeUnit: parsed.data.unitId, csrf: newCsrfToken() }
            };
            await store.put(next.id, next.record);
            await store.delete(old.id);
            return setSessionCookies(answer, next);
        });
    } catch {
        return problem(request, 503, 'unavailable');
    }
}
