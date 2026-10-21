/**
 * Default deny (security.md SEC-AC-1): every route handler says what it needs, with exactly one of
 *   `@Require('resource:action')`  a permission the caller holds in their active unit;
 *   `@SignedIn()`                  any signed-in caller with a role in their active unit (their own workspace);
 *   `@Public()`                    nobody (health checks, the public verification page).
 * The global AccessGuard asks the process's Authenticator who is calling and checks the permission; the problem filter
 * writes every refusal to the audit log (roles-and-permissions.md §3.5). The RouteInventory refuses to start a
 * process with a handler that is marked with none, or more than one. Without an Authenticator (the OpenAPI writer, tests)
 * every route that needs a caller answers 401, so nothing is open by accident.
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
import { PERMISSION } from '@itrms/module-sdk';
import type { FastifyRequest } from 'fastify';

import { currentContext, type Principal } from '../context';
import type { DbContext } from '../db/types';
import { ForbiddenError, UnauthenticatedError } from '../errors';

const REQUIRE = 'itrms:require';
const PUBLIC = 'itrms:public';
const SIGNED_IN = 'itrms:signed-in';

export type { Principal };

/** The permission a handler (or every handler of a controller) needs: `resource:action` (`org-unit:move`). */
export function Require(permission: string): MethodDecorator & ClassDecorator {
    if (!PERMISSION.test(permission)) throw new Error(`@Require('${permission}'): not a resource:action permission`);
    return SetMetadata(REQUIRE, permission);
}

/** A handler for any signed-in caller acting for a unit (their own workspace, their preferences). */
export const SignedIn = (): MethodDecorator & ClassDecorator => SetMetadata(SIGNED_IN, true);

/** A handler anyone may call: health checks, the public verification page. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC, true);

/**
 * Identifies the caller of a request: undefined when nobody is signed in (401); throws ForbiddenError for a signed-in
 * person who holds no role in the unit they ask to act for (403).
 */
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
        const signedIn = this.reflector.getAllAndOverride<boolean | undefined>(SIGNED_IN, targets);
        // the inventory stops such a process at start; this is the second line
        if (!permission && !signedIn) throw new ForbiddenError();

        const http = context.switchToHttp().getRequest<FastifyRequest>();
        const principal = await this.authenticator?.authenticate(http);
        if (!principal) throw new UnauthenticatedError();
        const request = currentContext();
        if (request) request.principal = principal;
        // the problem filter writes the refusal to the audit log
        if (permission && !principal.permissions.has(permission))
            throw new ForbiddenError({ audit: { reason: 'missing_permission', permission } });
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
                `Route handlers need exactly one of @Require, @SignedIn or @Public (SEC-AC-1): ${unmarked.join(', ')}`
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
            const marks = [PUBLIC, REQUIRE, SIGNED_IN].filter((mark) =>
                reflector.getAllAndOverride<unknown>(mark, targets)
            );
            // none, or more than one (a class-level @Public would silently override a handler's @Require)
            if (marks.length !== 1) unmarked.push(`${metatype.name}.${name}`);
        }
    }
    return unmarked;
}

const dbContextOf = (principal: Principal): DbContext => ({
    userId: principal.userId,
    unitId: principal.unitId,
    regionId: principal.regionId,
    scopePath: principal.scopePath
});

/** The database context of the signed-in caller (`db.scoped(requestDbContext(), …)`); 401 outside one. */
export function requestDbContext(): DbContext {
    const request = currentContext();
    const principal = request?.principal;
    if (!request || !principal) throw new UnauthenticatedError();
    return { requestId: request.requestId, ...dbContextOf(principal) };
}

/** The signed-in caller of the request being served; 401 outside one. */
export function currentPrincipal(): Principal {
    const principal = currentContext()?.principal;
    if (!principal) throw new UnauthenticatedError();
    return principal;
}
