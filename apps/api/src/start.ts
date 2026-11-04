/**
 * What every entry point does first: read its own configuration (and stop with a readable message when it is wrong, before
 * anything else starts), and create its logger.
 */
import { createLogger, type Logger } from '@itrms/kernel/api';
import { ConfigError, loadConfig, type ProcessKind } from '@itrms/kernel/config';

export function start<P extends ProcessKind>(processKind: P) {
    try {
        const config = loadConfig(processKind);
        return { config, logger: createLogger(config) };
    } catch (error) {
        // no logger yet: the configuration decides its level
        console.error(error instanceof ConfigError ? error.message : error);
        process.exit(1);
    }
}

/** BullMQ's connection, from the queues' Valkey URL: its workers wait on blocking commands, so no retry limit per request. */
export function queueConnection(valkeyUrl: string) {
    const url = new URL(valkeyUrl);
    return {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password ? decodeURIComponent(url.password) : undefined,
        db: Number(url.pathname.slice(1) || 0),
        tls: url.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null
    };
}

/** Logs a failure that stops the process, then exits with an error status. */
export function fail(logger: Logger, error: unknown): never {
    logger.fatal({ err: error }, 'the process stopped');
    process.exit(1);
}
