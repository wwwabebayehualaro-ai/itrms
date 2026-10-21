/**
 * The HTTP client the engine is given (task 0.5): the engine never imports an app, so the app passes its own client, which
 * owns authentication (token, refresh, sign-in redirect) and the Idempotency-Key of every POST. The engine never handles
 * credentials. The web app's client (`apps/web/src/lib/api/client.ts`) has this shape already.
 */
import { problemFieldErrors, problemMessage } from '@itrms/schemas';

export interface FormsRequestOptions {
    /** Query parameters: undefined and null are left out, arrays become repeated keys. */
    params?: object;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    responseType?: 'json' | 'blob' | 'text';
    /** Milliseconds; the call fails with code ECONNABORTED. */
    timeout?: number;
    /** Send anonymously (a template's public data source). */
    skipAuth?: boolean;
    onUploadProgress?: (progress: { loaded: number; total?: number }) => void;
}

export interface FormsRequest extends FormsRequestOptions {
    method?: string;
    url: string;
    data?: unknown;
}

export interface FormsResponse<T = unknown> {
    data: T;
    status: number;
    /** Lower-case header names. */
    headers: Record<string, string>;
}

export interface FormsClient {
    request<T = unknown>(config: FormsRequest): Promise<FormsResponse<T>>;
    get<T = unknown>(url: string, options?: FormsRequestOptions): Promise<FormsResponse<T>>;
    delete<T = unknown>(url: string, options?: FormsRequestOptions): Promise<FormsResponse<T>>;
    post<T = unknown>(url: string, data?: unknown, options?: FormsRequestOptions): Promise<FormsResponse<T>>;
    put<T = unknown>(url: string, data?: unknown, options?: FormsRequestOptions): Promise<FormsResponse<T>>;
    patch<T = unknown>(url: string, data?: unknown, options?: FormsRequestOptions): Promise<FormsResponse<T>>;
}

/** What a client throws for a failed call. A caller's own abort is not one: it stays a DOMException named AbortError. */
export interface FormsRequestError extends Error {
    readonly isApiError: true;
    readonly code: string;
    readonly response?: FormsResponse;
}

export const isRequestError = (error: unknown): error is FormsRequestError =>
    !!error && typeof error === 'object' && (error as { isApiError?: unknown }).isApiError === true;

/** Anything a call threw, as a message for the person: the error body's own message first. */
export function requestErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
    if (isRequestError(error)) {
        const message = problemMessage(error.response?.data);
        if (message) return message;
        if (error.code === 'ECONNABORTED') return 'The request timed out';
        if (!error.response) return 'Cannot reach the server';
        return error.message || fallback;
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

export interface ServerFormErrors {
    /** Message for the form as a whole (no field matched, or a non-validation failure). */
    form?: string;
    /** Field name (dotted path as the form uses it) → message. */
    fields: Record<string, string>;
}

/** A failed submit split into per-field messages (fields the form knows) and a message for the form. */
export function serverFormErrors(error: unknown, known?: Iterable<string>): ServerFormErrors {
    const split = isRequestError(error) ? problemFieldErrors(error.response?.data, known) : undefined;
    if (split) return { fields: split.fields, form: split.rest.length ? split.rest.join('; ') : undefined };
    return { fields: {}, form: requestErrorMessage(error) };
}

/**
 * Query-key factory, one shape for every resource (the app uses the same shape, so a key such as `['approvals']` is the
 * same cache entry on both sides).
 */
export function createKeys<Scope extends string>(scope: Scope) {
    return {
        all: [scope] as const,
        lists: () => [scope, 'list'] as const,
        list: <F extends object | undefined>(filters?: F) => [scope, 'list', filters ?? {}] as const,
        details: () => [scope, 'detail'] as const,
        detail: (id: string) => [scope, 'detail', id] as const
    };
}
