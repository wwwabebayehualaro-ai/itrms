// The AppError hierarchy (see index.ts).

/** One reason a value was refused: `path` as the client sends it (`items.2.qty`). */
export interface FieldError {
    path: string;
    code: string;
    message: string;
}

export interface AppErrorOptions {
    /** Shown to the person, in their language; leave it out rather than explain internals. */
    detail?: string;
    errors?: FieldError[];
    cause?: unknown;
}

export abstract class AppError extends Error {
    abstract readonly status: number;
    readonly detail?: string;
    readonly errors?: FieldError[];

    constructor(
        readonly code: string,
        options: AppErrorOptions = {}
    ) {
        super(options.detail ?? code, { cause: options.cause });
        this.name = new.target.name;
        this.detail = options.detail;
        this.errors = options.errors;
    }

    /** The message catalogue key of the title (`kernel.errors.not_found`). */
    get titleKey(): string {
        return `kernel.errors.${this.code}`;
    }
}

/** 400: a malformed request (unknown filter, bad paging, a body that is not JSON). */
export class InvalidRequestError extends AppError {
    readonly status = 400;
    constructor(code: 'invalid_query' | 'invalid_request' = 'invalid_request', options?: AppErrorOptions) {
        super(code, options);
    }
}

/** 401: no session, or an expired one. */
export class UnauthenticatedError extends AppError {
    readonly status = 401;
    constructor(options?: AppErrorOptions) {
        super('unauthenticated', options);
    }
}

/** 403: permission or unit scope. Never says anything about the record. */
export class ForbiddenError extends AppError {
    readonly status = 403;
    constructor(options?: AppErrorOptions) {
        super('forbidden', options);
    }
}

/** 404: missing, outside the person's scope, or a module not available here. */
export class NotFoundError extends AppError {
    readonly status = 404;
    constructor(code: 'not_found' | 'feature_disabled' = 'not_found', options?: AppErrorOptions) {
        super(code, options);
    }
}

/** 409: the state changed underneath the request. */
export class ConflictError extends AppError {
    readonly status = 409;
    constructor(
        code: 'stale_version' | 'idempotency_in_progress' | 'invalid_transition' | 'duplicate_reference',
        options?: AppErrorOptions
    ) {
        super(code, options);
    }
}

/** 422: the request is well-formed but its values or the business rules refuse it. */
export class ValidationError extends AppError {
    readonly status = 422;
    constructor(
        code: 'validation_failed' | 'idempotency_mismatch' | 'not_eligible' = 'validation_failed',
        options?: AppErrorOptions
    ) {
        super(code, options);
    }
}

/** 429: too many requests; `retryAfter` seconds go into the Retry-After header. */
export class RateLimitedError extends AppError {
    readonly status = 429;
    constructor(
        readonly retryAfter: number,
        options?: AppErrorOptions
    ) {
        super('rate_limited', options);
    }
}
