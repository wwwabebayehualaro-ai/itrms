// The HTTP process (code-structure.md §5.1): NestJS on Fastify with the kernel's problem+json filter and validation pipe.
import 'reflect-metadata';

import { createHttpApp } from '@itrms/kernel/api';
import { createDatabase } from '@itrms/kernel/db';
import { ValkeyRateLimiter } from '@itrms/kernel/limits';
import { Redis } from 'ioredis';

import { AppModule } from './app.module';
import { objectStoreOf } from './object-store';
import { fail, queueConnection, start } from './start';

async function main() {
    const { config, logger } = start('http');
    try {
        const database = createDatabase(config.DATABASE_URL, {
            applicationName: 'itrms-api',
            auditKey: config.AUDIT_HMAC_KEY,
            onError: (err) => logger.warn({ err }, 'an idle database connection failed')
        });
        // the rate limits count in the queues' Valkey (SEC-AP-2). A request never waits on it for long: commands fail after
        // half a second (the guard then lets the request through), and a dropped connection fails them at once
        const valkey = config.VALKEY_QUEUES_URL
            ? new Redis({
                  ...queueConnection(config.VALKEY_QUEUES_URL),
                  maxRetriesPerRequest: 1,
                  enableOfflineQueue: false,
                  commandTimeout: 500,
                  connectTimeout: 2000
              })
            : undefined;
        // its reconnect errors go to the logger (redacted), once a minute, not to the console
        let reported = 0;
        valkey?.on('error', (err: Error) => {
            if (Date.now() - reported < 60_000) return;
            reported = Date.now();
            logger.warn({ err }, "the rate limits' Valkey cannot be reached");
        });
        const rateLimiter = valkey ? new ValkeyRateLimiter(valkey) : undefined;
        const app = await createHttpApp(
            AppModule.forRoot(config, logger, { database, objectStore: objectStoreOf(config), rateLimiter }),
            config,
            logger
        );
        await app.listen({ port: config.PORT, host: config.HOST });
    } catch (error) {
        fail(logger, error);
    }
}

void main();
