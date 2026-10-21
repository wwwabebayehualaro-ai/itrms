/**
 * KernelModule.forRoot(config, logger): what every process gets from the kernel. The HTTP process also gets the
 * problem+json filter, the Zod validation pipe and the health endpoints; the worker and migrate processes run without
 * HTTP and only use the config, the logger and the metrics.
 */
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import type { KernelConfig } from './config';
import { ProblemFilter } from './errors/problem.filter';
import { HealthController, ReadinessRegistry } from './observability/health';
import type { Logger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { KERNEL_CONFIG, LOGGER } from './observability/tokens';

@Module({})
export class KernelModule {
    static forRoot(config: KernelConfig, logger: Logger): DynamicModule {
        const http: Provider[] =
            config.process === 'http'
                ? [
                      { provide: APP_FILTER, useClass: ProblemFilter },
                      { provide: APP_PIPE, useClass: ZodValidationPipe }
                  ]
                : [];
        return {
            module: KernelModule,
            global: true,
            controllers: config.process === 'http' ? [HealthController] : [],
            providers: [
                { provide: KERNEL_CONFIG, useValue: config },
                { provide: LOGGER, useValue: logger },
                Metrics,
                ReadinessRegistry,
                ...http
            ],
            exports: [KERNEL_CONFIG, LOGGER, Metrics, ReadinessRegistry]
        };
    }
}
