/**
 * The PDF worker (ADR-0006, ADR-0031 §10, task 0.23a): the same image as the API, consuming only the documents queue, with
 * its own memory limit (`start:worker-documents`; the Compose service sets the container's), so a Chrome spike never stalls
 * the outbox, SLA timers or notifications. It is the only process that launches Chrome. The main worker's relay feeds it.
 */
import 'reflect-metadata';

import { DOCUMENTS_QUEUE } from '@itrms/documents/contracts';
import { findChrome, fontFaces, pdfWorkerHandlers, PdfRenderer } from '@itrms/documents/api/pdf-worker';
import { startQueueConsumer } from '@itrms/kernel/api/worker';
import { createSystemDatabase } from '@itrms/kernel/db/system';

import { objectStoreOf } from './object-store';
import { fail, queueConnection, start } from './start';

function main() {
    const { config, logger } = start('worker');
    try {
        if (!config.DATABASE_SYSTEM_URL || !config.VALKEY_QUEUES_URL)
            throw new Error('the PDF worker needs DATABASE_SYSTEM_URL and VALKEY_QUEUES_URL');
        const store = objectStoreOf(config);
        if (!store) throw new Error('the PDF worker needs the object store');
        const executablePath = findChrome();
        if (!executablePath) throw new Error('the PDF worker needs Chrome: set CHROME_PATH');
        // the bundled fonts: a bad image stops here, never one document at a time
        fontFaces();
        const system = createSystemDatabase(config.DATABASE_SYSTEM_URL, {
            onUse: (reason, use) => {
                if (!use.recurring) logger.info({ reason, ...use.detail }, 'system context');
            },
            onError: (err) => logger.warn({ err }, 'an idle system connection failed')
        });
        const renderer = new PdfRenderer({ executablePath, noSandbox: process.env.CHROME_NO_SANDBOX === '1' });
        const consumer = startQueueConsumer({
            queue: DOCUMENTS_QUEUE,
            connection: queueConnection(config.VALKEY_QUEUES_URL),
            system,
            handlers: pdfWorkerHandlers(system, { store, renderer }),
            logger,
            concurrency: 2
        });
        const stop = async (signal: string) => {
            logger.info({ signal }, 'PDF worker stopping');
            try {
                await consumer.stop();
                await renderer.close();
                await system.close();
            } catch (err) {
                logger.error({ err }, 'the PDF worker did not stop cleanly');
                process.exitCode = 1;
            }
        };
        process.once('SIGTERM', () => void stop('SIGTERM'));
        process.once('SIGINT', () => void stop('SIGINT'));
        logger.info('PDF worker ready: consuming the documents queue');
    } catch (error) {
        fail(logger, error);
    }
}

main();
