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

/** Logs a failure that stops the process, then exits with an error status. */
export function fail(logger: Logger, error: unknown): never {
    logger.fatal({ err: error }, 'the process stopped');
    process.exit(1);
}
