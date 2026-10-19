import createClient from 'openapi-fetch';

import { session } from '../auth/session';
import { createHttpClient } from './http';
import type { paths } from './schema';

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_API;

/**
 * The single HTTP client for the app. It owns authentication (bearer token, one transparent refresh on 401, the sign-in
 * redirect), so features and template data sources never handle credentials. Requests flagged `skipAuth` are anonymous.
 * Every POST carries an Idempotency-Key: endpoints that support it act once even if the request is sent twice.
 */
const client = createHttpClient({
    baseUrl,
    session,
    onUnauthenticated: () => {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.assign(new URL(`/auth/login?next=${next}`, window.location.origin).href);
        }
    }
});

/** Typed client generated from the OpenAPI contract (tech-stack T10), on the same authorisation path. */
export const api = createClient<paths>({ baseUrl, fetch: (request) => client.authFetch(request) });

export default client;
export { ApiError, isApiError } from './http';
export type { HttpClient, HttpResponse, RequestConfig, RequestOptions } from './http';
