/**
 * `/healthz` (the process is alive: no dependency is checked, so a database outage does not restart the container) and
 * `/readyz` (it can serve: every registered readiness check passes within its time limit; the database and Valkey register
 * theirs in tasks 0.7 and 0.10). Plus `/metrics`. None of them needs a session; Nginx keeps them off the public site.
 */
import { Controller, Get, Injectable, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Metrics } from './metrics';

const CHECK_TIMEOUT_MS = 2000;

export type ReadinessCheck = () => Promise<void>;

@Injectable()
export class ReadinessRegistry {
    private readonly checks = new Map<string, ReadinessCheck>();

    register(name: string, check: ReadinessCheck) {
        this.checks.set(name, check);
    }

    /** Runs every check at once; a check that throws or takes longer than 2 s fails. */
    async run(): Promise<{ ready: boolean; checks: Record<string, 'ok' | 'failed'> }> {
        const results = await Promise.all(
            [...this.checks].map(async ([name, check]) => {
                let timer: NodeJS.Timeout | undefined;
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${name} timed out`)), CHECK_TIMEOUT_MS);
                });
                try {
                    await Promise.race([check(), timeout]);
                    return [name, 'ok'] as const;
                } catch {
                    return [name, 'failed'] as const;
                } finally {
                    clearTimeout(timer);
                }
            })
        );
        return { ready: results.every(([, r]) => r === 'ok'), checks: Object.fromEntries(results) };
    }
}

@Controller()
export class HealthController {
    constructor(
        private readonly readiness: ReadinessRegistry,
        private readonly metrics: Metrics
    ) {}

    @Get('healthz')
    healthz() {
        return { status: 'ok' };
    }

    @Get('readyz')
    async readyz(@Res({ passthrough: true }) reply: FastifyReply) {
        const { ready, checks } = await this.readiness.run();
        void reply.status(ready ? 200 : 503);
        return { status: ready ? 'ok' : 'unavailable', checks };
    }

    @Get('metrics')
    async metricsText(@Res({ passthrough: true }) reply: FastifyReply) {
        void reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        return this.metrics.render();
    }
}
