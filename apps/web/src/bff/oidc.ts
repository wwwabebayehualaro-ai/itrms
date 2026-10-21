/**
 * The OIDC client of the BFF (openid-client 6, ADR-0021): the authorization code flow with PKCE (S256), state and nonce,
 * refresh with rotation, and Keycloak's end-session endpoint. The client is confidential (`itrms-web` with its secret);
 * the browser never sees a code verifier, a code exchange or a token.
 */
import * as client from 'openid-client';

import type { BffConfig } from './config';

let discovered: Promise<client.Configuration> | undefined;

/** Seconds a call to Keycloak may take (runtime.ts holds the refresh lock longer). */
export const REFRESH_TIMEOUT_SECONDS = 10;

/** The realm's metadata, fetched once (and again after a failure). */
export function oidc(config: BffConfig): Promise<client.Configuration> {
    discovered ??= client
        .discovery(new URL(config.OIDC_ISSUER), config.OIDC_CLIENT_ID, config.OIDC_CLIENT_SECRET, undefined, {
            // the development realm is plain http on localhost; production refuses http in its configuration
            execute: config.OIDC_ISSUER.startsWith('http://') ? [client.allowInsecureRequests] : [],
            timeout: REFRESH_TIMEOUT_SECONDS
        })
        .then((configuration) => {
            // every call to Keycloak (code exchange, refresh) gives up after this; the refresh lock outlives it
            configuration.timeout = REFRESH_TIMEOUT_SECONDS;
            return configuration;
        })
        .catch((e: unknown) => {
            discovered = undefined;
            throw e;
        });
    return discovered;
}

/** What the browser's sign-in carries through Keycloak and back, sealed in a short-lived cookie. */
export interface LoginTransaction {
    verifier: string;
    state: string;
    nonce: string;
    returnTo: string;
    /** Step-up: the factors must have been entered no longer ago than this (seconds). */
    maxAge?: number;
}

export async function startSignIn(
    configuration: client.Configuration,
    redirectUri: string,
    returnTo: string,
    maxAge?: number
): Promise<{ url: URL; transaction: LoginTransaction }> {
    const verifier = client.randomPKCECodeVerifier();
    const transaction: LoginTransaction = {
        verifier,
        state: client.randomState(),
        nonce: client.randomNonce(),
        returnTo,
        maxAge
    };
    const parameters: Record<string, string> = {
        redirect_uri: redirectUri,
        scope: 'openid',
        response_type: 'code',
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state: transaction.state,
        nonce: transaction.nonce
    };
    // a step-up: Keycloak asks for the factors again (RFC 9470 with OIDC's max_age; prompt=login for an older session)
    if (maxAge !== undefined) Object.assign(parameters, { max_age: String(maxAge), prompt: 'login' });
    return { url: client.buildAuthorizationUrl(configuration, parameters), transaction };
}

export interface Tokens {
    accessToken: string;
    accessExpiresAt: number;
    refreshToken?: string;
    idToken?: string;
    sub?: string;
    sid?: string;
}

function tokensOf(response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers, now: number): Tokens {
    const claims = response.claims();
    return {
        accessToken: response.access_token,
        accessExpiresAt: now + (response.expiresIn() ?? 60) * 1000,
        refreshToken: response.refresh_token,
        idToken: response.id_token,
        sub: claims?.sub,
        sid: typeof claims?.sid === 'string' ? claims.sid : undefined
    };
}

/** Checks Keycloak's answer (state, PKCE, the ID token's nonce and auth_time) and exchanges the code. */
export async function finishSignIn(
    configuration: client.Configuration,
    callbackUrl: URL,
    transaction: LoginTransaction,
    now = Date.now()
): Promise<Tokens> {
    const response = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
        maxAge: transaction.maxAge
    });
    return tokensOf(response, now);
}

/** A new access token; Keycloak rotates the refresh token (`revokeRefreshToken`), so the new one replaces it. */
export async function refresh(configuration: client.Configuration, refreshToken: string, now = Date.now()) {
    return tokensOf(await client.refreshTokenGrant(configuration, refreshToken), now);
}

/** Keycloak's end-session page without an ID token (it asks the person to confirm): sign-out's fallback. */
export function endSessionUrl(configuration: client.Configuration, after: string): URL {
    return client.buildEndSessionUrl(configuration, {
        client_id: configuration.clientMetadata().client_id,
        post_logout_redirect_uri: after
    });
}

/**
 * Ends the Keycloak session server to server: Keycloak's logout endpoint with the session's refresh token and the client's
 * own credentials. The browser is never sent to the end-session endpoint, because that redirect would carry the ID token
 * in its URL (`id_token_hint`), and a token never goes in a URL (security.md SEC-WB-3).
 */
export async function endKeycloakSession(
    configuration: client.Configuration,
    clientSecret: string,
    refreshToken: string
): Promise<void> {
    const endpoint = configuration.serverMetadata().end_session_endpoint;
    if (!endpoint) throw new Error('the realm publishes no end_session_endpoint');
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: configuration.clientMetadata().client_id,
            client_secret: clientSecret,
            refresh_token: refreshToken
        }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Keycloak logout: ${response.status}`);
}
