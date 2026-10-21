/**
 * Keycloak's back-channel logout (SEC-SE-4): when a Keycloak session ends (sign-out elsewhere, an administrator, a
 * disabled account), Keycloak posts a signed logout token here and the BFF sessions of that Keycloak session end. Called
 * server to server: no cookie, no Origin; the token's signature is the authentication.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { verifyLogoutToken } from '@/bff/logout-token';
import { oidc } from '@/bff/oidc';
import { bff, realmKeys } from '@/bff/runtime';

const refuse = () =>
    NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: { 'cache-control': 'no-store' } });

export async function POST(request: NextRequest) {
    const { config, store } = bff();
    const form = await request.formData().catch(() => undefined);
    const token = form?.get('logout_token');
    if (typeof token !== 'string' || token.length > 8192) return refuse();

    const configuration = await oidc(config);
    const claims = await verifyLogoutToken(token, await realmKeys(), {
        issuer: configuration.serverMetadata().issuer,
        clientId: config.OIDC_CLIENT_ID
    });
    // a replayed token is refused (the spec's jti rule)
    if (!claims || !(await store.claim(`logout:${claims.jti}`, 3600))) return refuse();

    try {
        if (claims.sid) await store.deleteByKeycloakSession(claims.sid);
        else if (claims.sub) await store.deleteBySubject(claims.sub);
    } catch (e) {
        // not done: Keycloak's retry must not be refused as a replay
        await store.release(`logout:${claims.jti}`).catch(() => undefined);
        throw e;
    }
    return new NextResponse(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}
