/**
 * The app's HTTP core (replaces axios, tech-stack T10). One authorisation path for every call: the bearer token, an
 * Idempotency-Key on every POST, one transparent refresh and retry on 401 (with the same key), then the sign-in redirect.
 *
 * Two senders share it: `fetch` for everything, and XMLHttpRequest only when a caller wants upload progress (fetch cannot
 * report it). The typed openapi-fetch client (`client.ts`) goes through the same path.
 */

export type ResponseType = 'json' | 'blob' | 'text';
export type QueryValue = string | number | boolean | Date | null | undefined;

export interface RequestOptions {
    /**
     * Query parameters (any object, interfaces included). Undefined and null are left out, arrays become repeated keys and
     * dates ISO strings; a nested object is a programming error and throws.
     */
    params?: object;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    responseType?: ResponseType;
    /** Milliseconds; the call fails with code ECONNABORTED. */
    timeout?: number;
    /** Send anonymously: no token, no refresh, no sign-in redirect (public data sources, sign-in itself). */
    skipAuth?: boolean;
    onUploadProgress?: (progress: { loaded: number; total?: number }) => void;
}

export interface RequestConfig extends RequestOptions {
    method?: string;
    url: string;
    data?: unknown;
}

export interface HttpResponse<T = unknown> {
    data: T;
    status: number;
    /** Lower-case header names, as the old client gave them. */
    headers: Record<string, string>;
}

export type ApiErrorCode = 'ERR_BAD_RESPONSE' | 'ECONNABORTED' | 'ERR_NETWORK';

/** Anything an API call throws (except a caller's own abort, which stays a DOMException named AbortError). */
export class ApiError extends Error {
    readonly isApiError = true;

    constructor(
        message: string,
        readonly code: ApiErrorCode,
        readonly config: RequestConfig,
        readonly response?: HttpResponse
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const isApiError = (error: unknown): error is ApiError =>
    error instanceof ApiError ||
    (!!error && typeof error === 'object' && (error as { isApiError?: unknown }).isApiError === true);

export interface TokenSession {
    getAccessToken(): string | null;
    hasRefreshToken(): boolean;
    refresh(): Promise<string | null>;
    clear(): void;
}

export interface HttpDeps {
    baseUrl?: string;
    session: TokenSession;
    /** Called once a call is still unauthorised after the refresh (the browser goes to sign-in). */
    onUnauthenticated?: () => void;
    fetch?: typeof fetch;
    xhr?: () => XMLHttpRequest;
    newKey?: () => string;
}

export interface HttpClient {
    request<T = unknown>(config: RequestConfig): Promise<HttpResponse<T>>;
    get<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;
    delete<T = unknown>(url: string, options?: RequestOptions): Promise<HttpResponse<T>>;
    post<T = unknown>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
    put<T = unknown>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
    patch<T = unknown>(url: string, data?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>;
    /** A fetch with the same authorisation path, for clients that bring their own request building (openapi-fetch). */
    authFetch(request: Request): Promise<Response>;
}

/**
 * A random UUID v4. `randomUUID` exists only in secure contexts (HTTPS, localhost); `getRandomValues` exists everywhere,
 * so a page served over plain HTTP still gets an unguessable, collision-free key (never Math.random: SEC-CR-5).
 */
function defaultKey(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = Array.from(crypto.getRandomValues(new Uint8Array(16)));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** baseUrl + url the way the old client joined them (one slash between). Absolute URLs pass through. */
export function joinUrl(baseUrl: string | undefined, url: string, params?: object): string {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    let full = absolute || !baseUrl ? url : `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    const query = new URLSearchParams();
    appendEntries(params ?? {}, (k, v) => query.append(k, String(v)));
    const qs = query.toString();
    if (qs) full += (full.includes('?') ? '&' : '?') + qs;
    return full;
}

/** Flat key/value pairs from an object: undefined and null left out, arrays as repeated keys, dates as ISO strings. */
function appendEntries(source: object, append: (key: string, value: string | Blob) => void) {
    for (const [k, raw] of Object.entries(source) as [string, unknown][]) {
        for (const v of Array.isArray(raw) ? (raw as unknown[]) : [raw]) {
            if (v === undefined || v === null) continue;
            if (v instanceof Date) append(k, v.toISOString());
            else if (v instanceof Blob) append(k, v);
            else if (typeof v === 'object')
                throw new TypeError(`Parameter "${k}" is an object; send it as JSON instead`);
            else append(k, String(v as string | number | boolean | bigint));
        }
    }
}

const isBodyType = (data: unknown): data is XMLHttpRequestBodyInit =>
    typeof data === 'string' ||
    data instanceof FormData ||
    data instanceof Blob ||
    data instanceof URLSearchParams ||
    data instanceof ArrayBuffer;

/**
 * The body in the form the content type asks for (what axios did): a plain object becomes URLSearchParams for
 * x-www-form-urlencoded, FormData for multipart/form-data, JSON otherwise. Browser body types pass through.
 */
function encodeBody(data: unknown, headers: Headers): XMLHttpRequestBodyInit | undefined {
    if (data === undefined || data === null) return undefined;
    const type = (headers.get('content-type') ?? '').toLowerCase();
    let body: XMLHttpRequestBodyInit;
    if (isBodyType(data)) body = data;
    else if (type.startsWith('application/x-www-form-urlencoded')) {
        const form = new URLSearchParams();
        appendEntries(data as object, (k, v) => form.append(k, typeof v === 'string' ? v : String(v)));
        body = form;
    } else if (type.startsWith('multipart/form-data')) {
        const form = new FormData();
        appendEntries(data as object, (k, v) => form.append(k, v));
        body = form;
    } else {
        if (!type) headers.set('content-type', 'application/json');
        return JSON.stringify(data);
    }
    // A multipart content type set by hand has no boundary: let the browser write it.
    if (body instanceof FormData) headers.delete('content-type');
    return body;
}

/**
 * The caller's signal plus the timeout, without AbortSignal.any or AbortSignal.timeout (Chrome 116, Firefox 124 and
 * Safari 17.4 and later only; some offices run older browsers). `done()` clears the timer and the listener.
 */
function requestSignal(caller: AbortSignal | undefined, timeoutMs: number | undefined) {
    if (!timeoutMs) return { signal: caller, timedOut: () => false, done: () => {} };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('The request timed out', 'TimeoutError'));
    }, timeoutMs);
    const onAbort = () => controller.abort(caller?.reason);
    if (caller?.aborted) onAbort();
    else caller?.addEventListener('abort', onAbort, { once: true });
    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        done() {
            clearTimeout(timer);
            caller?.removeEventListener('abort', onAbort);
        }
    };
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

const headerObject = (h: Headers) => Object.fromEntries([...h.entries()].map(([k, v]) => [k.toLowerCase(), v]));

async function readBody(res: Response, responseType: ResponseType): Promise<unknown> {
    if (responseType === 'blob') return res.blob();
    const text = await res.text();
    if (responseType === 'text' || !text) return text || undefined;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }
    return text;
}

export function createHttpClient(deps: HttpDeps): HttpClient {
    const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
    const newKey = deps.newKey ?? defaultKey;

    /** Runs `send` with the current token; on 401 refreshes once and sends again; still 401 → sign-in. */
    async function authorized<R extends { status: number }>(
        skipAuth: boolean,
        send: (token: string | null) => Promise<R>
    ) {
        const first = await send(skipAuth ? null : deps.session.getAccessToken());
        if (first.status !== 401 || skipAuth) return first;
        if (deps.session.hasRefreshToken()) {
            const token = await deps.session.refresh();
            if (token) {
                const second = await send(token);
                if (second.status !== 401) return second;
            }
        }
        deps.session.clear();
        deps.onUnauthenticated?.();
        return first;
    }

    /**
     * URL, headers (without the token) and body, built once before anything is sent: a bad parameter, header or body
     * throws here as itself instead of being reported as a network error, and every attempt sends the same bytes.
     */
    function prepare(config: RequestConfig, key: string | null) {
        const url = joinUrl(deps.baseUrl, config.url, config.params);
        const headers = new Headers(config.headers);
        if (!headers.has('accept')) headers.set('accept', 'application/json');
        if (key && !headers.has('idempotency-key')) headers.set('idempotency-key', key);
        const body = encodeBody(config.data, headers);
        const withToken = (token: string | null) => {
            const h = new Headers(headers);
            if (token) h.set('authorization', `Bearer ${token}`);
            return h;
        };
        return { url, body, withToken };
    }

    async function viaFetch(config: RequestConfig, method: string, key: string | null): Promise<HttpResponse> {
        const { url, body, withToken } = prepare(config, key);
        const { signal, timedOut, done } = requestSignal(config.signal, config.timeout);
        let response: HttpResponse;
        let ok: boolean;
        try {
            const res = await authorized(!!config.skipAuth, (token) =>
                doFetch(url, { method, headers: withToken(token), body, signal })
            );
            ok = res.ok;
            response = {
                status: res.status,
                headers: headerObject(res.headers),
                data: await readBody(res, res.ok ? (config.responseType ?? 'json') : 'json')
            };
        } catch (e) {
            if (timedOut()) throw new ApiError('The request timed out', 'ECONNABORTED', config);
            if (config.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw abortError();
            throw new ApiError('Network Error', 'ERR_NETWORK', config);
        } finally {
            done();
        }
        if (!ok)
            throw new ApiError(
                `Request failed with status code ${response.status}`,
                'ERR_BAD_RESPONSE',
                config,
                response
            );
        return response;
    }

    /** XMLHttpRequest, only for upload progress. Same authorisation path and the same result shape. */
    async function viaXhr(config: RequestConfig, method: string, key: string | null): Promise<HttpResponse> {
        const makeXhr = deps.xhr ?? (() => new XMLHttpRequest());
        const { url, body, withToken } = prepare(config, key);
        const signal = config.signal;
        const result = await authorized(
            !!config.skipAuth,
            (token) =>
                new Promise<{ status: number; xhr: XMLHttpRequest }>((resolve, reject) => {
                    if (signal?.aborted) return reject(abortError());
                    const xhr = makeXhr();
                    const onAbort = () => {
                        xhr.abort();
                        reject(abortError());
                    };
                    const settle = (fn: () => void) => () => {
                        signal?.removeEventListener('abort', onAbort);
                        fn();
                    };
                    xhr.open(method, url);
                    withToken(token).forEach((v, k) => xhr.setRequestHeader(k, v));
                    xhr.responseType = config.responseType === 'blob' ? 'blob' : 'text';
                    if (config.timeout) xhr.timeout = config.timeout;
                    xhr.upload.onprogress = (e) =>
                        config.onUploadProgress?.({
                            loaded: e.loaded,
                            total: e.lengthComputable ? e.total : undefined
                        });
                    xhr.onload = settle(() => resolve({ status: xhr.status, xhr }));
                    xhr.onerror = settle(() => reject(new ApiError('Network Error', 'ERR_NETWORK', config)));
                    xhr.ontimeout = settle(() => reject(new ApiError('The request timed out', 'ECONNABORTED', config)));
                    signal?.addEventListener('abort', onAbort, { once: true });
                    xhr.send(body ?? null);
                })
        );
        const { xhr, status } = result;
        const headers = Object.fromEntries(
            xhr
                .getAllResponseHeaders()
                .trim()
                .split(/[\r\n]+/)
                .filter(Boolean)
                .map((line) => {
                    const i = line.indexOf(':');
                    return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
                })
        );
        let data: unknown = xhr.response;
        if (
            xhr.responseType === 'text' &&
            typeof data === 'string' &&
            (headers['content-type'] ?? '').includes('json')
        ) {
            try {
                data = data ? JSON.parse(data) : undefined;
            } catch {
                /* not JSON after all: keep the text */
            }
        }
        const response: HttpResponse = { status, headers, data };
        if (status < 200 || status >= 300) {
            throw new ApiError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, response);
        }
        return response;
    }

    function request<T>(config: RequestConfig): Promise<HttpResponse<T>> {
        const method = (config.method ?? 'GET').toUpperCase();
        // One key per call, decided before the first attempt, so the retry after a refresh sends the same key.
        const key = method === 'POST' ? newKey() : null;
        const send = config.onUploadProgress ? viaXhr : viaFetch;
        return send(config, method, key) as Promise<HttpResponse<T>>;
    }

    return {
        request,
        get: (url, options) => request({ ...options, url, method: 'GET' }),
        delete: (url, options) => request({ ...options, url, method: 'DELETE' }),
        post: (url, data, options) => request({ ...options, url, data, method: 'POST' }),
        put: (url, data, options) => request({ ...options, url, data, method: 'PUT' }),
        patch: (url, data, options) => request({ ...options, url, data, method: 'PATCH' }),
        authFetch(req) {
            const key = req.method === 'POST' ? newKey() : null;
            return authorized(false, (token) => {
                const attempt = req.clone();
                const headers = new Headers(attempt.headers);
                if (token) headers.set('authorization', `Bearer ${token}`);
                if (key && !headers.has('idempotency-key')) headers.set('idempotency-key', key);
                return doFetch(new Request(attempt, { headers }));
            });
        }
    };
}
