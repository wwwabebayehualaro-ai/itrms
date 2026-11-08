/**
 * Every failed request answers RFC 9457 `application/problem+json` (api-guidelines.md §4): `type`, `title` (in the person's
 * language), `status`, `code`, `detail`, `errors[{ path, code, message }]` and `traceId` (the request id, which people quote
 * to support). AppErrors say what they are; request validation is 422 `validation_failed` with one entry per bad value;
 * framework errors keep their status but not their wording; anything else is 500 `internal_error` and only the log has the
 * cause.
 */
import { Catch, HttpException, Inject, Optional, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

import am from '../../messages/am.json';
import en from '../../messages/en.json';
import { fallbackChain } from '@itrms/schemas';

import { currentContext, languageFrom, requestIdFrom, type Language } from '../context';
import type { Database } from '../db/database';
import { DATABASE, LOGGER } from '../observability/tokens';
import type { Logger } from '../observability/logger';
import { SHELL, type Shell } from '../iam/shell';
import type { Catalogues } from '../iam/menu';
import { AppError, ForbiddenError, RateLimitedError, StepUpRequiredError, type FieldError } from './app-error';

export interface Problem {
    type: string;
    title: string;
    status: number;
    code: string;
    detail?: string;
    errors?: FieldError[];
    traceId?: string;
}

const CATALOGUES: Partial<Record<Language, Record<string, string>>> = { am, en };

/** The title in the person's language; English when a language lacks it (optional languages fall back). */
const titleOf = (code: string, language: Language) => {
    const key = `kernel.errors.${code}`;
    return CATALOGUES[language]?.[key] ?? en[key as keyof typeof en] ?? key;
};

/**
 * An AppError's detail in the person's language: its `detailKey` from the installed slices' catalogues (the language,
 * then its fallbacks, then English), with `{name}` placeholders filled from `params`; else its plain `detail`.
 */
function detailOf(error: AppError, language: Language, messages: Catalogues): string | undefined {
    if (error.detailKey) {
        for (const lang of [...fallbackChain(language), 'en']) {
            const text = messages[lang]?.[error.detailKey];
            if (text)
                return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
                    error.params && name in error.params ? String(error.params[name]) : whole
                );
        }
    }
    return error.detail;
}

/** Statuses the framework raises itself (unknown route, body too large, malformed JSON) and the code each one reports. */
const STATUS_CODES: Record<number, string> = {
    400: 'invalid_request',
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    422: 'validation_failed',
    429: 'rate_limited',
    503: 'unavailable'
};

const fieldErrors = (error: ZodError): FieldError[] =>
    error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));

/**
 * Fastify's own errors (bad JSON, body too large) keep their 4xx status; nothing else about them is shown. Any other error
 * with a statusCode (an HTTP client's "upstream answered 401") is a failure of ours: a logged 500, never passed on.
 */
const clientStatusOf = (error: unknown): number | undefined => {
    const e = error as { name?: unknown; code?: unknown; statusCode?: unknown } | null;
    const fastify = e?.name === 'FastifyError' || (typeof e?.code === 'string' && e.code.startsWith('FST_'));
    const status = e?.statusCode;
    return fastify && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

/**
 * PostgreSQL refusals that are the request's, not ours (the driver's error, or its cause when the query builder wraps it):
 * a unique key already taken is 409 `duplicate_reference`; a referenced record that does not exist or is out of the
 * person's scope is 404; a row-level-security check is 403 (the guards should have refused first: logged as a warning,
 * and the person learns nothing about the row). The API's role reads server messages in English (roles.psql).
 */
export function databaseRefusalOf(error: unknown): { status: number; code: string } | undefined {
    for (
        let e = error as { code?: unknown; message?: unknown; cause?: unknown } | undefined, depth = 0;
        e && depth < 3;
        depth++
    ) {
        if (e.code === '23505') return { status: 409, code: 'duplicate_reference' };
        if (e.code === '23503') return { status: 404, code: 'not_found' };
        if (e.code === '42501' && typeof e.message === 'string' && e.message.includes('violates row-level security'))
            return { status: 403, code: 'forbidden' };
        if (e.code === '42501' && isForgedContextMessage(e.message)) return { status: 403, code: 'forbidden' };
        e = e.cause as typeof e;
    }
    return undefined;
}

const isForgedContextMessage = (message: unknown) => typeof message === 'string' && message.startsWith('kernel.ctx:');

/**
 * The database refused the request context as not the API's own (a forged, tampered, expired or retired-key token,
 * ADR-0048): either a bug or an attack, so it is logged at error level, whatever the person is told.
 */
export function isForgedContext(error: unknown): boolean {
    for (
        let e = error as { code?: unknown; message?: unknown; cause?: unknown } | undefined, depth = 0;
        e && depth < 3;
        depth++
    ) {
        if (e.code === '42501' && isForgedContextMessage(e.message)) return true;
        e = e.cause as typeof e;
    }
    return false;
}

/**
 * The status of a Nest HTTP exception, also one built by another installed copy of `@nestjs/common` (the lockfile may hold
 * several, by peer dependency): `instanceof` fails across copies, so a slice's `ParseUUIDPipe` refusal would read as a 500.
 */
function httpStatusOf(error: unknown): number | undefined {
    if (error instanceof HttpException) return error.getStatus();
    const e = error as { getStatus?: unknown; getResponse?: unknown } | null;
    if (typeof e?.getStatus !== 'function' || typeof e.getResponse !== 'function') return undefined;
    const status: unknown = e.getStatus.call(error);
    return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
}

/** A nestjs-zod request validation error, from whichever installed copy built it (as above). */
function zodErrorOf(error: unknown): { found: boolean; cause?: unknown } {
    if (error instanceof ZodValidationException) return { found: true, cause: error.getZodError() };
    const e = error as { getZodError?: unknown; getStatus?: unknown } | null;
    if (typeof e?.getZodError !== 'function' || typeof e.getStatus !== 'function') return { found: false };
    return { found: true, cause: e.getZodError.call(error) };
}

/** The problem body for anything thrown while serving a request. */
export function problemOf(error: unknown, language: Language, traceId?: string, messages: Catalogues = {}): Problem {
    const make = (status: number, code: string, extra: Partial<Problem> = {}): Problem => ({
        type: `urn:itrms:problem:${code}`,
        title: titleOf(code, language),
        status,
        code,
        ...extra,
        ...(traceId ? { traceId } : {})
    });
    if (error instanceof AppError) {
        const detail = detailOf(error, language, messages);
        return make(error.status, error.code, {
            ...(detail ? { detail } : {}),
            ...(error.errors?.length ? { errors: error.errors } : {})
        });
    }
    const refusal = databaseRefusalOf(error);
    if (refusal) return make(refusal.status, refusal.code);
    const zod = zodErrorOf(error);
    if (zod.found)
        return make(422, 'validation_failed', zod.cause instanceof ZodError ? { errors: fieldErrors(zod.cause) } : {});
    const status = httpStatusOf(error) ?? clientStatusOf(error);
    if (status !== undefined && status < 500) return make(status, STATUS_CODES[status] ?? 'invalid_request');
    if (status === 503) return make(503, 'unavailable');
    return make(500, 'internal_error');
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
    constructor(
        @Inject(LOGGER) private readonly logger: Logger,
        @Optional() @Inject(DATABASE) private readonly database?: Database,
        @Optional() @Inject(SHELL) private readonly shell?: Shell
    ) {}

    /**
     * Every refusal is on record (roles-and-permissions.md §3.5): who (or which account, when no role was found), the unit,
     * the route and the reason, in a transaction of its own so it stays when the request fails. A refusal that cannot be
     * recorded still stands; that it could not be is logged as an incident.
     */
    private async recordDenial(error: unknown, route: string) {
        if (!this.database) return;
        const request = currentContext();
        const principal = request?.principal;
        const reason = databaseRefusalOf(error) ? 'row_level_security' : 'forbidden';
        const data = { route, reason, ...(error instanceof ForbiddenError ? error.audit : {}) };
        try {
            await this.database.recordSensitiveEvent(
                {
                    requestId: request?.requestId,
                    ip: request?.ip,
                    // the refused account, as the authenticator verified it (its token's subject)
                    ...(request?.subject ? { subject: request.subject } : {}),
                    ...(principal && {
                        userId: principal.userId,
                        unitId: principal.unitId,
                        regionId: principal.regionId,
                        scopePath: principal.scopePath
                    })
                },
                { type: 'access.denied', data }
            );
        } catch (failure) {
            this.logger.error({ err: failure, ...data }, 'a denial could not be written to the audit log');
        }
    }

    async catch(error: unknown, host: ArgumentsHost) {
        const http = host.switchToHttp();
        const request = http.getRequest<FastifyRequest>();
        const reply = http.getResponse<FastifyReply>();
        const context = currentContext();
        const problem = problemOf(
            error,
            context?.language ?? languageFrom(request.headers['accept-language']),
            context?.requestId ?? requestIdFrom(request.id),
            this.shell?.messages
        );
        if (isForgedContext(error))
            this.logger.error({ err: error, status: problem.status }, 'security: forged_context');
        else if (problem.status >= 500) this.logger.error({ err: error, status: problem.status }, 'request failed');
        else if (databaseRefusalOf(error)?.code === 'forbidden')
            this.logger.warn(
                { code: problem.code, status: problem.status },
                'row-level security refused a write the guards let through'
            );
        else this.logger.debug({ code: problem.code, status: problem.status }, 'request refused');
        if (problem.status === 403)
            await this.recordDenial(error, `${request.method} ${request.routeOptions.url ?? request.url}`);
        if (error instanceof RateLimitedError) void reply.header('retry-after', String(error.retryAfter));
        // RFC 9470: the client signs the person in again, no longer ago than max_age
        if (error instanceof StepUpRequiredError)
            void reply.header(
                'www-authenticate',
                `Bearer error="insufficient_user_authentication", max_age=${error.maxAge}`
            );
        void reply
            .status(problem.status)
            .header('content-type', 'application/problem+json; charset=utf-8')
            .send(problem);
    }
}
