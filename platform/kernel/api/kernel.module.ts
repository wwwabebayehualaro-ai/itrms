/**
 * KernelModule.forRoot(config, logger, { database }): what every process gets from the kernel. The HTTP process also gets
 * the problem+json filter, the Zod validation pipe and the health endpoints; the worker and migrate processes run without
 * HTTP. The process's entry creates the database and hands it over (tests and the OpenAPI writer run without one); the
 * kernel provides it to the slices (DATABASE), checks it for readiness and closes it at shutdown.
 */
import {
    Inject,
    Injectable,
    Module,
    type DynamicModule,
    type OnApplicationShutdown,
    type OnModuleInit,
    type Provider
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import type { KernelConfig } from './config';
import { FieldCrypto } from './crypto/field-crypto';
import { FilesController } from './files/files.controller';
import { NO_OBJECT_STORE, type ObjectStore } from './files/object-store';
import type { Database } from './db/database';
import { ProblemFilter } from './errors/problem.filter';
import { EffectRegistry } from './effects';
import { AccessGuard, AUTHENTICATOR, RouteInventory, type Authenticator } from './iam/access';
import { IamController } from './iam/iam.controller';
import { OidcAuthenticator, type OidcOptions } from './iam/oidc-authenticator';
import type { RolePermissions } from './iam/roles';
import { IdempotencyInterceptor } from './idempotency/idempotency';
import { JobsController } from './outbox/jobs.controller';
import { SettingsController } from './settings/settings.controller';
import { SHELL, type Shell } from './iam/shell';
import { OrgAdminService } from './org/org-admin.service';
import { OrgController } from './org/org.controller';
import { HealthController, ReadinessRegistry } from './observability/health';
import type { Logger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { DATABASE, FIELD_CRYPTO, KERNEL_CONFIG, LOGGER, OBJECT_STORE } from './observability/tokens';

/** Registers the database's readiness check and closes its pool when the process stops. */
@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
    constructor(
        @Inject(DATABASE) private readonly database: Database,
        private readonly readiness: ReadinessRegistry
    ) {}

    onModuleInit() {
        this.readiness.register('database', () => this.database.ping());
    }

    async onApplicationShutdown() {
        await this.database.close();
    }
}

export interface KernelOptions {
    database?: Database;
    /** Who is calling. Without one (and without `identity`) every route that needs a caller answers 401. */
    authenticator?: Authenticator;
    /** The Keycloak realm whose tokens the HTTP process accepts; with a database it gives the OidcAuthenticator. */
    identity?: OidcOptions;
    /** What each role grants, from the installed manifests. */
    roles?: RolePermissions;
    /** The object store's adapter (files, task 0.15); without one, a file route fails clearly. */
    objectStore?: ObjectStore;
    /** The enabled manifests and their catalogues: the menu `/me/workspace` computes (ADR-0028). */
    shell?: Shell;
}

/** The OpenAPI writer and unit tests run without a database: a route that reaches it fails loudly. */
const unavailable = () => Promise.reject(new Error('This process has no database'));
const NO_DATABASE: Database = {
    scoped: unavailable,
    recordSensitiveEvent: unavailable,
    ping: unavailable,
    close: () => Promise.resolve()
};

function authenticatorOf(options: KernelOptions): Provider[] {
    const authenticator =
        options.authenticator ??
        (options.identity && options.database
            ? new OidcAuthenticator(options.database, options.roles ?? new Map(), options.identity)
            : undefined);
    return authenticator ? [{ provide: AUTHENTICATOR, useValue: authenticator }] : [];
}

@Module({})
export class KernelModule {
    static forRoot(config: KernelConfig, logger: Logger, options: KernelOptions = {}): DynamicModule {
        const http: Provider[] =
            config.process === 'http'
                ? [
                      { provide: APP_FILTER, useClass: ProblemFilter },
                      { provide: APP_PIPE, useClass: ZodValidationPipe },
                      { provide: APP_GUARD, useClass: AccessGuard },
                      // after the guard (it needs the caller): every POST is idempotent
                      { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
                      RouteInventory,
                      OrgAdminService,
                      ...authenticatorOf(options)
                  ]
                : [];
        const database: Provider[] = options.database
            ? [{ provide: DATABASE, useValue: options.database }, DatabaseLifecycle]
            : [{ provide: DATABASE, useValue: NO_DATABASE }];
        return {
            module: KernelModule,
            global: true,
            // the route inventory (http) and the effect registry (every process) look through the providers
            imports: [DiscoveryModule],
            controllers:
                config.process === 'http'
                    ? [
                          HealthController,
                          OrgController,
                          IamController,
                          JobsController,
                          SettingsController,
                          FilesController
                      ]
                    : [],
            providers: [
                { provide: KERNEL_CONFIG, useValue: config },
                { provide: SHELL, useValue: options.shell ?? { manifests: [], messages: {} } },
                { provide: LOGGER, useValue: logger },
                { provide: OBJECT_STORE, useValue: options.objectStore ?? NO_OBJECT_STORE },
                {
                    provide: FIELD_CRYPTO,
                    useValue: new FieldCrypto(
                        config.process === 'migrate'
                            ? {}
                            : { fieldKeys: config.FIELD_KEYS, blindIndexKey: config.BLIND_INDEX_KEY }
                    )
                },
                Metrics,
                ReadinessRegistry,
                EffectRegistry,
                ...database,
                ...http
            ],
            exports: [
                KERNEL_CONFIG,
                LOGGER,
                // the installed manifests: the roles a workflow may assign (task 0.19a)
                SHELL,
                Metrics,
                ReadinessRegistry,
                EffectRegistry,
                DATABASE,
                FIELD_CRYPTO,
                OBJECT_STORE
            ]
        };
    }
}
