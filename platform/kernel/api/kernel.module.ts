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
import { APP_FILTER, APP_GUARD, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import type { KernelConfig } from './config';
import type { Database } from './db/database';
import { ProblemFilter } from './errors/problem.filter';
import { AccessGuard, AUTHENTICATOR, RouteInventory, type Authenticator } from './iam/access';
import { OrgAdminService } from './org/org-admin.service';
import { OrgController } from './org/org.controller';
import { HealthController, ReadinessRegistry } from './observability/health';
import type { Logger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { DATABASE, KERNEL_CONFIG, LOGGER } from './observability/tokens';

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
    /** Who is calling (task 0.10). Without one every `@Require` route answers 401. */
    authenticator?: Authenticator;
}

/** The OpenAPI writer and unit tests run without a database: a route that reaches it fails loudly. */
const unavailable = () => Promise.reject(new Error('This process has no database'));
const NO_DATABASE: Database = {
    scoped: unavailable,
    recordSensitiveEvent: unavailable,
    ping: unavailable,
    close: () => Promise.resolve()
};

@Module({})
export class KernelModule {
    static forRoot(config: KernelConfig, logger: Logger, options: KernelOptions = {}): DynamicModule {
        const http: Provider[] =
            config.process === 'http'
                ? [
                      { provide: APP_FILTER, useClass: ProblemFilter },
                      { provide: APP_PIPE, useClass: ZodValidationPipe },
                      { provide: APP_GUARD, useClass: AccessGuard },
                      RouteInventory,
                      OrgAdminService,
                      ...(options.authenticator ? [{ provide: AUTHENTICATOR, useValue: options.authenticator }] : [])
                  ]
                : [];
        const database: Provider[] = options.database
            ? [{ provide: DATABASE, useValue: options.database }, DatabaseLifecycle]
            : [{ provide: DATABASE, useValue: NO_DATABASE }];
        return {
            module: KernelModule,
            global: true,
            imports: config.process === 'http' ? [DiscoveryModule] : [],
            controllers: config.process === 'http' ? [HealthController, OrgController] : [],
            providers: [
                { provide: KERNEL_CONFIG, useValue: config },
                { provide: LOGGER, useValue: logger },
                Metrics,
                ReadinessRegistry,
                ...database,
                ...http
            ],
            exports: [KERNEL_CONFIG, LOGGER, Metrics, ReadinessRegistry, DATABASE]
        };
    }
}
