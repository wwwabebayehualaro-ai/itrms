/**
 * Starting a process: the HTTP application on Fastify with the kernel's request handling, or an application context for
 * the worker (no HTTP). The entry points in apps/api call these with the process's own config (code-structure.md §5.1).
 */
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';

import type { DynamicModule, INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import type { HttpConfig } from './config';
import { languageFrom, requestIdFrom, runInContext, type RequestContext } from './context';
import { PinoNestLogger, type Logger } from './observability/logger';
import { Metrics } from './observability/metrics';

type RootModule = Type | DynamicModule;

/** Is a peer address one of the trusted proxies (addresses or CIDR ranges; IPv4-mapped IPv6 counts as IPv4)? */
export function trustedPeers(proxies: string[]): (address: string | undefined) => boolean {
    if (!proxies.length) return () => false;
    const list = new BlockList();
    for (const entry of proxies) {
        const [address = '', bits] = entry.split('/');
        const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
        if (bits === undefined) list.addAddress(address, family);
        else list.addSubnet(address, Number(bits), family);
    }
    return (address) => {
        if (!address) return false;
        const plain = address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
        return list.check(plain, isIP(plain) === 6 ? 'ipv6' : 'ipv4');
    };
}

export async function createHttpApp(
    root: RootModule,
    config: HttpConfig,
    logger: Logger
): Promise<NestFastifyApplication> {
    const trusted = trustedPeers(config.TRUSTED_PROXIES);
    const adapter = new FastifyAdapter({
        loggerInstance: logger,
        // the proxy's id when a trusted proxy sent one and it is safe to log and echo, else a new one (also the problem
        // bodies' traceId): a client cannot pick the id its request is logged and supported under
        genReqId: (request: IncomingMessage) =>
            requestIdFrom(trusted(request.socket.remoteAddress) ? request.headers['x-request-id'] : undefined),
        trustProxy: config.TRUSTED_PROXIES.length ? config.TRUSTED_PROXIES : false,
        bodyLimit: config.BODY_LIMIT
    });
    const fastify = adapter.getInstance();
    const contexts = new WeakMap<object, RequestContext>();
    fastify.addHook('onRequest', (request, reply, done) => {
        void reply.header('x-request-id', request.id);
        const context = { requestId: request.id, language: languageFrom(request.headers['accept-language']) };
        contexts.set(request, context);
        runInContext(context, () => done());
    });
    // Reading the body continues in the socket's async context, not the request's: enter it again before the handler.
    fastify.addHook('preHandler', (request, _reply, done) => {
        const context = contexts.get(request);
        if (context) runInContext(context, () => done());
        else done();
    });

    const app = await NestFactory.create<NestFastifyApplication>(root, adapter, {
        logger: new PinoNestLogger(logger),
        abortOnError: false
    });
    const metrics = app.get(Metrics);
    fastify.addHook('onResponse', (request, reply, done) => {
        metrics.recordRequest(
            request.method,
            request.routeOptions.url ?? 'unmatched',
            reply.statusCode,
            reply.elapsedTime / 1000
        );
        done();
    });
    app.enableShutdownHooks();
    return app;
}

/** The worker's context: the same modules, no HTTP server. */
export async function createWorkerContext(root: RootModule, logger: Logger): Promise<INestApplicationContext> {
    const context = await NestFactory.createApplicationContext(root, {
        logger: new PinoNestLogger(logger),
        abortOnError: false
    });
    context.enableShutdownHooks();
    return context;
}
