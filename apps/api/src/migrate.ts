/**
 * The migrate process: applies the database migrations, run by the Compose `migrate` service before the app starts. The
 * migration history arrives with the database foundation (task 0.7); until then it checks its configuration and exits.
 */
import { start } from './start';

const { logger } = start('migrate');
logger.info('no migrations yet');
