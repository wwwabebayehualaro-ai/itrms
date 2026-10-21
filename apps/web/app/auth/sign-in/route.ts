// Starts a sign-in: off to Keycloak with PKCE, state and nonce, kept sealed in a ten-minute cookie (ADR-0021).
import { NextResponse, type NextRequest } from 'next/server';

import { oidc, startSignIn } from '@/bff/oidc';
import { bff, problem, safeReturnPath } from '@/bff/runtime';
import { seal } from '@/bff/seal';
import { LOGIN_COOKIE } from '@/lib/auth/cookies';

export async function GET(request: NextRequest) {
    const { config } = bff();
    const query = request.nextUrl.searchParams;
    const returnTo = safeReturnPath(query.get('return_to'));
    const maxAgeText = query.get('max_age');
    const maxAge = maxAgeText && /^\d{1,5}$/.test(maxAgeText) ? Number(maxAgeText) : undefined;

    let configuration;
    try {
        configuration = await oidc(config);
    } catch {
        return problem(request, 503, 'unavailable');
    }
    const { url, transaction } = await startSignIn(
        configuration,
        `${config.APP_ORIGIN}/auth/callback`,
        returnTo,
        maxAge
    );
    const response = NextResponse.redirect(url, 303);
    response.headers.set('cache-control', 'no-store');
    response.cookies.set(LOGIN_COOKIE, seal(config.keyring, JSON.stringify(transaction), LOGIN_COOKIE), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600
    });
    return response;
}
