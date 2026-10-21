/**
 * @itrms/api-client: the API's contract as TypeScript (generated from openapi.json) and a typed fetch client on it
 * (openapi-fetch, tech-stack T10). The web app's BFF calls the API through it; paths, parameters, bodies and responses
 * are checked against the contract at compile time.
 */
import createClient from 'openapi-fetch';

import type { components, paths } from './schema';

export type { components, operations, paths } from './schema';

/** The problem+json body of every failed call. */
export type Problem = components['schemas']['Problem'];

export interface ApiClientOptions {
    /** The API's address, e.g. http://api:4000. */
    baseUrl: string;
    /** The fetch to send with (the BFF passes one that adds the session's token and the request id). */
    fetch?: (request: Request) => Promise<Response>;
}

export function createApiClient({ baseUrl, fetch }: ApiClientOptions) {
    return createClient<paths>({ baseUrl, ...(fetch ? { fetch } : {}) });
}
