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
        // the rate limits count in the queues' Valkey (SEC-AP-2); a request never waits on a reconnect for long
        const rateLimiter = config.VALKEY_QUEUES_URL
            ? new ValkeyRateLimiter(
                  new Redis({
                      ...queueConnection(config.VALKEY_QUEUES_URL),
                      maxRetriesPerRequest: 1,
                      enableOfflineQueue: false
                  })
              )
            : undefined;
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
