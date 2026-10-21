import createClient from 'openapi-fetch';

import { session } from '../auth/session';
import { createHttpClient } from './http';
import type { paths } from './schema';

/** The BFF's proxy on the app's own origin (ADR-0021): it adds the bearer token and the active unit server-side. */
const baseUrl = '/api/';

/**
 * The single HTTP client for the app. The browser holds no credentials: the BFF session cookie travels by itself, this
 * client adds the CSRF token to state-changing calls and an Idempotency-Key to every POST, and a 401 sends the person to
 * sign-in. Requests flagged `skipAuth` never redirect.
 */
const client = createHttpClient({
    baseUrl,
    session,
    onUnauthenticated: (maxAge) => {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) session.signIn(maxAge);
    }
});

/** Typed client generated from the OpenAPI contract (tech-stack T10), on the same path. */
export const api = createClient<paths>({ baseUrl, fetch: (request) => client.authFetch(request) });

export default client;
export { ApiError, isApiError } from './http';
export type { HttpClient, HttpResponse, RequestConfig, RequestOptions } from './http';
