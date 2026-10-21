/**
 * Default deny (security.md SEC-AC-1): every route handler says the permission it needs with `@Require('resource:action')`,
 * or that it needs none with `@Public()`. The global AccessGuard refuses a request to a handler that says neither, asks
 * the process's Authenticator who is calling, and checks the permission against what that person holds in the active
 * unit. The RouteInventory refuses to start a process with an unmarked handler.
 *
 * Authentication arrives with Keycloak (task 0.10); until a process is given an Authenticator, every `@Require` route
 * answers 401, so nothing is open by accident.
 */
import {
    Inject,
    Injectable,
    Optional,
    SetMetadata,
    type CanActivate,
    type ExecutionContext,
    type OnModuleInit
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { currentContext, type Principal } from '../context';
import type { DbContext } from '../db/types';
import { ForbiddenError, UnauthenticatedError } from '../errors';

const REQUIRE = 'itrms:require';
const PUBLIC = 'itrms:public';

export type { Principal };

/** A permission: `resource:action` (`org_unit:move`), lower-case words and underscores. */
const PERMISSION = /^[a-z][a-z0-9_.]*:[a-z][a-z0-9_]*$/;

/** The permission a handler (or every handler of a controller) needs. */
export function Require(permission: string): MethodDecorator & ClassDecorator {
    if (!PERMISSION.test(permission)) throw new Error(`@Require('${permission}'): not a resource:action permission`);
    return SetMetadata(REQUIRE, permission);
}

/** A handler anyone may call: health checks, the public verification page. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC, true);

/** Identifies the caller of a request; undefined when nobody is signed in. Bound by the process (task 0.10). */
export interface Authenticator {
    authenticate(request: FastifyRequest): Promise<Principal | undefined>;
}

export const AUTHENTICATOR = Symbol('kernel.authenticator');

@Injectable()
export class AccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @Optional() @Inject(AUTHENTICATOR) private readonly authenticator?: Authenticator
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const targets = [context.getHandler(), context.getClass()];
        if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
        const permission = this.reflector.getAllAndOverride<string | undefined>(REQUIRE, targets);
        // the inventory stops such a process at start; this is the second line
        if (!permission) throw new ForbiddenError();
        const principal = await this.authenticator?.authenticate(context.switchToHttp().getRequest<FastifyRequest>());
        if (!principal) throw new UnauthenticatedError();
        const request = currentContext();
        if (request) request.principal = principal;
        if (!principal.permissions.has(permission)) throw new ForbiddenError();
        return true;
    }
}

/** Every handler of every controller is marked; the process does not start otherwise. */
@Injectable()
export class RouteInventory implements OnModuleInit {
    constructor(
        private readonly discovery: DiscoveryService,
        private readonly scanner: MetadataScanner,
        private readonly reflector: Reflector
    ) {}

    onModuleInit() {
        const unmarked = unmarkedRoutes(this.discovery, this.scanner, this.reflector);
        if (unmarked.length > 0)
            throw new Error(
                `Route handlers need exactly one of @Require or @Public (SEC-AC-1): ${unmarked.join(', ')}`
            );
    }
}

export function unmarkedRoutes(discovery: DiscoveryService, scanner: MetadataScanner, reflector: Reflector): string[] {
    const unmarked: string[] = [];
    for (const wrapper of discovery.getControllers()) {
        // the class, not an instance: request-scoped controllers have none at start
        const metatype = wrapper.metatype as (abstract new (...args: never[]) => object) | null | undefined;
        if (!metatype || typeof metatype !== 'function') continue;
        const prototype = metatype.prototype as object;
        for (const name of scanner.getAllMethodNames(prototype)) {
            const handler = (prototype as Record<string, unknown>)[name];
            if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
            const targets = [handler, metatype];
            const isPublic = reflector.getAllAndOverride<boolean | undefined>(PUBLIC, targets);
            const required = reflector.getAllAndOverride<string | undefined>(REQUIRE, targets);
            // neither, or both (a class-level @Public would silently override a handler's @Require)
            if (Boolean(isPublic) === Boolean(required)) unmarked.push(`${metatype.name}.${name}`);
        }
    }
    return unmarked;
}

/** The database context of the signed-in caller (`db.scoped(requestDbContext(), …)`); 401 outside one. */
export function requestDbContext(): DbContext {
    const request = currentContext();
    const principal = request?.principal;
    if (!request || !principal) throw new UnauthenticatedError();
    return {
        requestId: request.requestId,
        userId: principal.userId,
        unitId: principal.unitId,
        regionId: principal.regionId,
        scopePath: principal.scopePath
    };
}
