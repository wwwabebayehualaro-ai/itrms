/**
 * The worker process: the same modules without HTTP. It consumes the BullMQ queues once they exist (task 0.10); until then
 * it starts, reports ready and waits. Nest's shutdown hooks close it on SIGTERM / SIGINT.
 */
import 'reflect-metadata';

import { createWorkerContext } from '@itrms/kernel/api';
import { createDatabase } from '@itrms/kernel/db';

import { AppModule } from './app.module';
import { fail, start } from './start';

async function main() {
    const { config, logger } = start('worker');
    try {
        const database = createDatabase(config.DATABASE_URL, {
            applicationName: 'itrms-worker',
            auditKey: config.AUDIT_HMAC_KEY,
            onError: (err) => logger.warn({ err }, 'an idle database connection failed')
        });
        await createWorkerContext(AppModule.forRoot(config, logger, { database }), logger);
        // nothing to consume yet: an idle timer keeps the process alive until its stop signal
        setInterval(() => undefined, 60_000);
        logger.info('worker ready');
    } catch (error) {
        fail(logger, error);
    }
}

void main();
