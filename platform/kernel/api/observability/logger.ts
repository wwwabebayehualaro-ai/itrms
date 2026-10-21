/**
 * JSON logs (pino) for every process. Secrets never reach a log line (SEC-SC-2): every log object is walked before it is
 * written, values under keys named like secrets are redacted at any depth and in any case, and a password inside a
 * connection string (`postgres://user:secret@host`) is masked in every string, error messages and stacks included.
 * Each line of a request carries its request id.
 */
import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

import type { KernelConfig } from '../config';
import { currentContext } from '../context';

export type { Logger } from 'pino';

const CENSOR = '[redacted]';

/** Keys whose values are never logged, whatever their case or depth (`Authorization`, `body.user.password`). */
const SECRET_KEY =
    /^(password|passwd|pwd|secret|token|access_?token|refresh_?token|id_?token|api_?key|authorization|cookie|set-cookie|client_?secret|private_?key|signing_?key)$/i;

/** Header paths the request/response serializers produce (pino's own redaction; the walk below covers the rest). */
export const REDACTED_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]'
];

// scheme://userinfo@ where the userinfo holds a ':' (user:password), up to the last @ of the token: a password may hold '/'
// or '@', and the user may be empty (redis://:password@). A token ends at whitespace, a quote or a comma, so JSON text
// around a URL is left alone. Bounded, so a long token cannot make the match slow.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{0,30}:\/\/)([^\s"',]{0,256}:[^\s"',]{0,256})@/gi;

/** Masks the user and password of every `scheme://user:password@` in a text. */
export const maskSecrets = (text: string): string => text.replace(URL_CREDENTIALS, '$1***@');

const isPlain = (value: object) => {
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/**
 * A copy of a log value with secrets removed: strings masked, secret keys redacted, plain objects and arrays walked (to a
 * depth of 8). Anything else (an Error, a request) is left to its serializer and is walked after serialization.
 */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') return maskSecrets(value);
    if (!value || typeof value !== 'object' || depth > 8) return value;
    if (seen.has(value)) return '[circular]';
    if (Array.isArray(value)) {
        seen.add(value);
        return value.map((v) => scrub(v, depth + 1, seen));
    }
    if (!isPlain(value)) return value;
    seen.add(value);
    return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? CENSOR : scrub(v, depth + 1, seen)])
    );
}

/** Errors, and anything thrown that is not one (a string, null, a plain object), as a scrubbed log value. */
function serializeError(err: unknown): unknown {
    if (err instanceof Error) return scrub({ ...pino.stdSerializers.err(err) });
    if (typeof err === 'string') return { message: maskSecrets(err) };
    if (err && typeof err === 'object') return scrub(err);
    return { message: String(err) };
}

export function createLogger(
    config: Pick<KernelConfig, 'LOG_LEVEL' | 'process'>,
    destination?: pino.DestinationStream
) {
    return pino(
        {
            level: config.LOG_LEVEL,
            base: { app: 'itrms-api', process: config.process },
            timestamp: pino.stdTimeFunctions.isoTime,
            formatters: {
                level: (label) => ({ level: label }),
                log: (object) => scrub(object) as Record<string, unknown>
            },
            redact: { paths: REDACTED_PATHS, censor: CENSOR },
            mixin: () => {
                const context = currentContext();
                return context ? { requestId: context.requestId } : {};
            },
            serializers: { err: serializeError },
            hooks: {
                logMethod(args, method) {
                    const masked = args.map((a: unknown) => (typeof a === 'string' ? maskSecrets(a) : a));
                    method.apply(this, masked as Parameters<typeof method>);
                }
            }
        },
        destination
    );
}

/** NestJS's own messages (startup, routes) go to the same pino logger. */
export class PinoNestLogger implements LoggerService {
    constructor(private readonly logger: Logger) {}

    private write(level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace', message: unknown, rest: unknown[]) {
        // Nest passes the context (a class name) last; an error's stack comes before it
        const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
        if (message instanceof Error) this.logger[level]({ err: message, context }, message.message);
        else this.logger[level]({ context }, typeof message === 'string' ? message : JSON.stringify(message));
    }

    log(message: unknown, ...rest: unknown[]) {
        this.write('info', message, rest);
    }
    error(message: unknown, ...rest: unknown[]) {
        this.write('error', message, rest);
    }
    warn(message: unknown, ...rest: unknown[]) {
        this.write('warn', message, rest);
    }
    debug(message: unknown, ...rest: unknown[]) {
        this.write('debug', message, rest);
    }
    verbose(message: unknown, ...rest: unknown[]) {
        this.write('trace', message, rest);
    }
    fatal(message: unknown, ...rest: unknown[]) {
        this.write('fatal', message, rest);
    }
}
