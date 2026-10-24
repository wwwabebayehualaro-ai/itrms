// The HTTP process (code-structure.md §5.1): NestJS on Fastify with the kernel's problem+json filter and validation pipe.
import 'reflect-metadata';

import { createHttpApp } from '@itrms/kernel/api';
import { createDatabase } from '@itrms/kernel/db';

import { AppModule } from './app.module';
import { objectStoreOf } from './object-store';
import { fail, start } from './start';

async function main() {
    const { config, logger } = start('http');
    try {
        const database = createDatabase(config.DATABASE_URL, {
            applicationName: 'itrms-api',
            auditKey: config.AUDIT_HMAC_KEY,
            onError: (err) => logger.warn({ err }, 'an idle database connection failed')
        });
        const app = await createHttpApp(
            AppModule.forRoot(config, logger, { database, objectStore: objectStoreOf(config) }),
            config,
            logger
        );
        await app.listen({ port: config.PORT, host: config.HOST });
    } catch (error) {
        fail(logger, error);
    }
}

void main();
