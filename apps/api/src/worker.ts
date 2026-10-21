/**
 * The worker process: the same modules without HTTP. It consumes the BullMQ queues once they exist (task 0.10); until then
 * it starts, reports ready and waits. Nest's shutdown hooks close it on SIGTERM / SIGINT.
 */
import 'reflect-metadata';

import { createWorkerContext } from '@itrms/kernel/api';

import { AppModule } from './app.module';
import { fail, start } from './start';

async function main() {
    const { config, logger } = start('worker');
    try {
        await createWorkerContext(AppModule.forRoot(config, logger), logger);
        // nothing to consume yet: an idle timer keeps the process alive until its stop signal
        setInterval(() => undefined, 60_000);
        logger.info('worker ready');
    } catch (error) {
        fail(logger, error);
    }
}

void main();
