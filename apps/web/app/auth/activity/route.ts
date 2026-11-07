/**
 * The person is at the page, typing or reading, without a request of their own for a while (apps/web/src/lib/auth/
 * activity.ts): their session's idle timeout starts again. A post from the app's own page, with its CSRF token.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { sameOrigin, tokenMatches } from '@/bff/csrf';
import { bff, currentSession, problem } from '@/bff/runtime';
import { CSRF_HEADER } from '@/lib/auth/cookies';

export async function POST(request: NextRequest) {
    const { config } = bff();
    if (!sameOrigin(request.headers, config.APP_ORIGIN)) return problem(request, 403, 'forbidden');
    const current = await currentSession(request, { touch: false });
    if (!current) return problem(request, 401, 'unauthenticated');
    if (!tokenMatches(request.headers.get(CSRF_HEADER), current.record.csrf)) return problem(request, 403, 'forbidden');
    // the CSRF token checked first: only then is the session's idle timeout restarted
    if (!(await currentSession(request))) return problem(request, 401, 'unauthenticated');
    return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
