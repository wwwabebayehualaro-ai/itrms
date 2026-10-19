import client, { type ApiError, type RequestConfig } from '@/lib/api/client';
import { extractReferences, getByPath, isEmptyValue, resolveBindings, resolveString } from './expression';
import { applyResponseMapping, mapError, matchesCondition } from './mapping';
import { DataSourceDefinition, RuntimeContext } from './types';

/** Headers a template author may never set: auth and transport are owned by the app client. */
const BLOCKED_HEADERS = new Set([
    'authorization',
    'cookie',
    'host',
    'proxy-authorization',
    'x-forwarded-for',
    'content-length',
    'origin',
    'referer'
]);
const DEFAULT_TIMEOUT = 15000;

export class DataSourceError extends Error {
    status?: number;
    constructor(
        message: string,
        status?: number,
        public cause?: unknown
    ) {
        super(message);
        this.name = 'DataSourceError';
        this.status = status;
    }
}

export interface PreparedRequest {
    config: RequestConfig;
    /** Stable key describing the resolved request, for caching. */
    key: unknown[];
}

/** Every reference the definition needs before it can run. */
export function getDependencies(ds: DataSourceDefinition): string[] {
    const refs = extractReferences([ds.request.url, ds.request.pathParams, ds.request.query, ds.request.body]);
    (ds.dependsOn ?? []).forEach((d) => refs.add(d.replace(/^\{\{|\}\}$/g, '').trim()));
    return [...refs];
}

/** Only relative, same-backend URLs are allowed so credentials never leak to a foreign origin. */
function assertSafeUrl(url: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
        throw new DataSourceError('Absolute URLs are not allowed in data sources; use a path relative to the backend');
    }
    if (url.split('/').includes('..')) throw new DataSourceError('Path traversal is not allowed in data source URLs');
}

export function isEnabled(ds: DataSourceDefinition, ctx: RuntimeContext): boolean {
    if (
        ds.enabledWhen?.length &&
        !ds.enabledWhen.every((c) =>
            matchesCondition(c, ctx.form, {
                data: ctx.data,
                user: ctx.user,
                route: ctx.route,
                variables: ctx.variables
            })
        )
    )
        return false;
    return getDependencies(ds).every((ref) => !isEmptyValue(getByPath(ctx, ref)));
}

export function prepareRequest(ds: DataSourceDefinition, ctx: RuntimeContext, bodyOverride?: unknown): PreparedRequest {
    const { request } = ds;
    const c = ctx as Record<string, any>;

    let url = resolveString(request.url, c);
    Object.entries(request.pathParams ?? {}).forEach(([name, tpl]) => {
        // A plain replace-all: a parameter name is configuration, never a pattern.
        url = url.split(`{${name}}`).join(encodeURIComponent(String(resolveString(tpl, c) ?? '')));
    });
    url = String(url);
    assertSafeUrl(url);

    const params: Record<string, any> = {};
    Object.entries(request.query ?? {}).forEach(([k, tpl]) => {
        const v = resolveString(tpl, c);
        if (!isEmptyValue(v)) params[k] = v;
    });

    const headers: Record<string, string> = {};
    Object.entries(request.headers ?? {}).forEach(([k, tpl]) => {
        if (BLOCKED_HEADERS.has(k.toLowerCase())) return;
        headers[k] = String(resolveString(tpl, c) ?? '');
    });
    if (request.contentType && request.method !== 'GET') headers['Content-Type'] = request.contentType;

    // A caller-supplied body is already resolved and is sent verbatim so user-typed `{{...}}` text is never re-evaluated.
    const body =
        request.method === 'GET'
            ? undefined
            : bodyOverride !== undefined
              ? bodyOverride
              : resolveBindings(request.body ?? {}, c);

    return {
        // `skipAuth` tells the shared client to send anonymously (auth is never configured in templates).
        config: {
            method: request.method,
            url,
            params,
            headers,
            data: body,
            timeout: ds.timeoutMs ?? DEFAULT_TIMEOUT,
            ...(ds.auth === 'none' ? { skipAuth: true } : {})
        },
        key: [ds.id, request.method, url, params, body]
    };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Only idempotent reads are retried; a mutation may already have been applied server-side. */
const isRetryable = (e: ApiError, method: string) =>
    method === 'GET' && (!e.response || e.response.status >= 500 || e.response.status === 429);

/**
 * Execute a data source through the shared authenticated client.
 * Returns the response after `responseMapping` has been applied.
 */
export async function executeDataSource(
    ds: DataSourceDefinition,
    ctx: RuntimeContext,
    opts: { signal?: AbortSignal; bodyOverride?: unknown } = {}
) {
    const { config } = prepareRequest(ds, ctx, opts.bodyOverride);
    const attempts = Math.max(1, ds.retry?.attempts ?? 1);
    let delay = ds.retry?.delayMs ?? 500;

    for (let attempt = 1; ; attempt++) {
        try {
            const res = await client.request({ ...config, signal: opts.signal });
            return applyResponseMapping(res.data, ds.responseMapping);
        } catch (err) {
            // A caller's abort is not a failure of the data source.
            if (opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
            const e = err as ApiError;
            if (attempt >= attempts || !isRetryable(e, config.method ?? 'GET')) {
                throw new DataSourceError(mapError(e, ds.errorMapping), e.response?.status, err);
            }
            await sleep(delay);
            delay *= ds.retry?.backoffFactor ?? 2;
        }
    }
}
