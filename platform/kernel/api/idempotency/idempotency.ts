/**
 * Idempotent POSTs (architecture.md §15, ADR-0031, api-guidelines.md): every POST carries an `Idempotency-Key`. The
 * interceptor answers a replay from the stored response before the handler runs; otherwise it hands the handler's business
 * transaction a hook that claims the key in that transaction (so the record commits or rolls back with the work) and
 * stores the handler's result before the commit.
 *   - same key, same request: the first response again, with `Idempotent-Replayed: true`;
 *   - same key, another request: 422 `idempotency_mismatch`;
 *   - same key while the first is still running: 409 `idempotency_in_progress`.
 * Records are kept 7 days (the worker's sweep deletes them after).
 *
 * A POST whose answer must never be stored (`@NotReplayable`: a reveal, whose answer holds sensitive fields in clear)
 * keeps no record: sent again, it runs again, and is audited again.
 */
import { createHmac, randomBytes } from 'node:crypto';

import {
    Inject,
    Injectable,
    SetMetadata,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, from, of, tap, type Observable } from 'rxjs';

import { currentContext, type Principal } from '../context';
import type { Database } from '../db/database';
import { plain } from '../db/audit';
import type { TransactionHook, Tx } from '../db/types';
import { ConflictError, InvalidRequestError, ValidationError } from '../errors';
import type { KernelConfig } from '../config';
import type { Logger } from '../observability/logger';
import { DATABASE, KERNEL_CONFIG, LOGGER } from '../observability/tokens';
import { idempotencyKeys } from './idempotency.table';

export const RETENTION_DAYS = 7;

const NOT_REPLAYABLE = 'kernel:not-replayable';
/**
 * A POST whose response must not be kept for replay (it holds sensitive fields in clear): no idempotency record. Only for
 * reads that change nothing but the audit log, which records each call.
 */
export function NotReplayable(): MethodDecorator {
    return (target, key, descriptor) => {
        NOT_REPLAYABLE_HANDLERS.add(`${target.constructor.name}.${String(key)}`);
        SetMetadata(NOT_REPLAYABLE, true)(target, key, descriptor);
    };
}

const NOT_REPLAYABLE_HANDLERS = new Set<string>();
/** Every handler marked @NotReplayable (`Controller.method`): a test keeps the list reviewed. */
export const notReplayableHandlers = (): string[] => [...NOT_REPLAYABLE_HANDLERS].sort();
/** The first key of the idempotency locks: no other advisory lock of the installation shares their space. */
export const LOCK_NAMESPACE = 0x1de4;
/** The second key: the record's identity, hashed. */
export const lockKey = (c: { userId: string; unitId: string; method: string; path: string; key: string }) =>
    JSON.stringify([c.userId, c.unitId, c.method, c.path, c.key]);
const KEY = /^[\x21-\x7e]{1,255}$/;

/** A stored answer found where the work was about to start: the interceptor sends it instead. */
export class IdempotentReplay extends Error {
    constructor(
        readonly statusCode: number,
        readonly response: unknown
    ) {
        super('idempotent replay');
    }
}

/** Keys sorted at every level, so the same body hashes the same whatever order its fields came in. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, canonical((value as Record<string, unknown>)[k])])
        );
    return value;
}

/**
 * The fingerprint of a request, keyed: an HMAC, never a plain hash, because a body may hold a FIN or a phone number and an
 * unkeyed hash of a small space can be reversed by trying every value (SEC-PD-1).
 */
export function requestHash(key: Buffer, method: string, path: string, unitId: string, body: unknown): string {
    return createHmac('sha256', key)
        .update(JSON.stringify([method, path, unitId, canonical(body ?? null)]))
        .digest('hex');
}

/**
 * The installation's key for request fingerprints, derived from AUDIT_HMAC_KEY (required in production); without one (a
 * development process) a key of the process's own, so a replay after a restart is refused as a different request.
 */
export function requestHashKey(config: KernelConfig): Buffer {
    const auditKey = config.process === 'migrate' ? undefined : config.AUDIT_HMAC_KEY;
    return auditKey ? createHmac('sha256', auditKey).update('itrms:idempotency').digest() : randomBytes(32);
}

interface Claim {
    userId: string;
    unitId: string;
    regionId: string;
    method: string;
    path: string;
    key: string;
    hash: string;
    statusCode: number;
}

const sameKey = (c: Claim) =>
    and(
        eq(idempotencyKeys.userId, c.userId),
        eq(idempotencyKeys.unitId, c.unitId),
        eq(idempotencyKeys.method, c.method),
        eq(idempotencyKeys.path, c.path),
        eq(idempotencyKeys.key, c.key)
    );

/** The stored answer for the key (still within its 7 days), or undefined; 422 when it was for another request. */
async function storedAnswer(tx: Tx, c: Claim): Promise<IdempotentReplay | undefined> {
    const [row] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(sameKey(c), gt(idempotencyKeys.expiresAt, sql`now()`)));
    if (!row) return undefined;
    if (row.requestHash !== c.hash)
        throw new ValidationError('idempotency_mismatch', {
            detail: 'This Idempotency-Key was used for a different request.'
        });
    return new IdempotentReplay(row.statusCode, row.response);
}

/** The hook the handler's business transaction runs: claim the key first, store the result last. */
export function idempotencyHook(c: Claim): TransactionHook {
    let id: string | undefined;
    return {
        async begin(tx) {
            // a second request with the key while the first is still running: refuse at once rather than wait for it
            const locked = await tx.execute<{ locked: boolean }>(
                sql`select pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${lockKey(c)})) as locked`
            );
            if (!locked.rows[0]?.locked) throw new ConflictError('idempotency_in_progress');
            const replay = await storedAnswer(tx, c);
            if (replay) throw replay;
            await tx.delete(idempotencyKeys).where(and(sameKey(c), lte(idempotencyKeys.expiresAt, sql`now()`)));
            const [row] = await tx
                .insert(idempotencyKeys)
                .values({
                    userId: c.userId,
                    unitId: c.unitId,
                    regionId: c.regionId,
                    method: c.method,
                    path: c.path,
                    key: c.key,
                    requestHash: c.hash,
                    statusCode: c.statusCode,
                    expiresAt: sql`now() + ${`${RETENTION_DAYS} days`}::interval`
                })
                .returning({ id: idempotencyKeys.id });
            id = row?.id;
        },
        async end(tx, result) {
            if (!id) return;
            await tx
                .update(idempotencyKeys)
                .set({ response: result === undefined ? null : plain(result) })
                .where(eq(idempotencyKeys.id, id));
        }
    };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        @Inject(DATABASE) private readonly database: Database,
        @Inject(LOGGER) private readonly logger: Logger,
        @Inject(KERNEL_CONFIG) private readonly config: KernelConfig
    ) {
        this.hashKey = requestHashKey(config);
    }

    private readonly hashKey: Buffer;

    /**
     * A POST does its work in one transaction, which carries its idempotency record: with none, nothing is kept, and with
     * several, the record would be the first one's while a later one could fail. A programming error: refused in
     * development and tests, an incident in production (the response stands, its replay may not).
     */
    private checkOneTransaction(hook: TransactionHook, route: string) {
        const n = hook.transactions ?? 0;
        if (n === 1) return;
        const problem = `${route}: a POST must do its work in exactly one db.scoped transaction (it opened ${n})`;
        if (this.config.NODE_ENV === 'production') this.logger.error({ route, transactions: n }, problem);
        else throw new Error(problem);
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const http = context.switchToHttp();
        const request = http.getRequest<FastifyRequest>();
        const reqContext = currentContext();
        const principal: Principal | undefined = reqContext?.principal;
        // POSTs of a signed-in caller; public endpoints (verification, webhooks) have their own replay rules
        if (request.method !== 'POST' || !principal || !reqContext) return next.handle();
        if (this.reflector.get<boolean | undefined>(NOT_REPLAYABLE, context.getHandler())) return next.handle();

        const header = request.headers['idempotency-key'];
        const key = typeof header === 'string' ? header : undefined;
        if (!key || !KEY.test(key))
            throw new InvalidRequestError('invalid_request', {
                detail: 'Send an Idempotency-Key (1 to 255 visible characters) with every POST.'
            });
        const statusCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? 201;
        const path = request.url;
        const claim: Claim = {
            userId: principal.userId,
            unitId: principal.unitId,
            regionId: principal.regionId,
            method: 'POST',
            path,
            key,
            hash: requestHash(this.hashKey, 'POST', path, principal.unitId, request.body),
            statusCode
        };
        const reply = http.getResponse<FastifyReply>();
        const answer = (replay: IdempotentReplay) => {
            void reply.status(replay.statusCode).header('idempotent-replayed', 'true');
            return replay.response;
        };

        const scope = {
            requestId: reqContext.requestId,
            userId: principal.userId,
            regionId: principal.regionId,
            unitId: principal.unitId,
            scopePath: principal.scopePath
        };
        const replay = await this.database.scoped(scope, (tx) => storedAnswer(tx, claim));
        if (replay) return of(answer(replay));

        // the handler's business transaction finds it through requestDbContext()
        reqContext.transactionHook = idempotencyHook(claim);
        const hook = reqContext.transactionHook;
        return next.handle().pipe(
            tap(() => this.checkOneTransaction(hook, `POST ${request.routeOptions.url ?? path}`)),
            catchError((error: unknown) => {
                if (error instanceof IdempotentReplay) return from([answer(error)]);
                throw error;
            })
        );
    }
}
