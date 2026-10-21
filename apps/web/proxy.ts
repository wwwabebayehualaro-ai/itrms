/**
 * Runs before every page and BFF route (Next.js proxy):
 *   - the security headers of security.md SEC-WB-1: a nonce-based CSP with 'strict-dynamic', HSTS, frame-ancestors
 *     'none' and the rest; Trusted Types in report-only mode (SEC-WB-2);
 *   - pages need a session: a browser without the session cookie goes to sign-in. Whether the session is valid is
 *     decided by the BFF's `/api` proxy on the page's first call; this only spares an anonymous visitor a page that
 *     can't load.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/cookies';

/** The BFF's own routes: they answer a missing session themselves (401, or Keycloak's sign-in). */
const OPEN = ['/auth/', '/api/'];

export function contentSecurityPolicy(nonce: string, options: { dev: boolean; signInOrigin?: string }): string {
    return [
        "default-src 'self'",
        // 'strict-dynamic': scripts the nonced ones load are trusted; host lists are ignored by browsers that know it
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ''}`,
        // style attributes (Radix positions popovers with them); no style can run code
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        // a form's redirects count too: sign-out posts here and its redirects end on Keycloak's sign-in page
        `form-action 'self'${options.signInOrigin ? ` ${options.signInOrigin}` : ''}`,
        "frame-ancestors 'none'",
        ...(options.dev ? [] : ['upgrade-insecure-requests'])
    ].join('; ');
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-site',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'x-frame-options': 'DENY',
    'content-security-policy-report-only': "require-trusted-types-for 'script'"
};

function nonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes));
}

/** The realm's origin when Keycloak is on another origin than the app (development); production serves it under /auth. */
function signInOrigin(): string | undefined {
    try {
        return process.env.OIDC_ISSUER ? new URL(process.env.OIDC_ISSUER).origin : undefined;
    } catch {
        return undefined;
    }
}

export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    // never the request's own Host in production: a forged one would choose where the redirect goes
    const origin =
        process.env.APP_ORIGIN ?? (process.env.NODE_ENV === 'production' ? undefined : request.nextUrl.origin);
    if (!origin) throw new Error('APP_ORIGIN is not set');

    let response: NextResponse;
    const value = nonce();
    const csp = contentSecurityPolicy(value, {
        dev: process.env.NODE_ENV === 'development',
        signInOrigin: signInOrigin()
    });
    if (!OPEN.some((p) => pathname.startsWith(p)) && !request.cookies.has(SESSION_COOKIE)) {
        const signIn = new URL('/auth/sign-in', origin);
        signIn.searchParams.set('return_to', pathname + search);
        response = NextResponse.redirect(signIn, 303);
    } else {
        const forwarded = new Headers(request.headers);
        forwarded.set('x-nonce', value);
        forwarded.set('content-security-policy', csp);
        response = NextResponse.next({ request: { headers: forwarded } });
    }
    response.headers.set('content-security-policy', csp);
    for (const [name, header] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, header);
    return response;
}

export const config = {
    matcher: [
        // prefetches too: a header the client sends must never switch the security headers off
        '/((?!_next/static|_next/image|favicon.ico).*)'
    ]
};
