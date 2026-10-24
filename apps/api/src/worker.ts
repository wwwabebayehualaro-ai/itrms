/**
 * The worker process: the same modules without HTTP, plus the background work (architecture.md §12). With the system pool
 * (DATABASE_SYSTEM_URL) and the queues' Valkey (VALKEY_QUEUES_URL) it relays the outbox, runs its handlers and sweeps;
 * without them it starts, reports ready and waits. Nest's shutdown hooks close it on SIGTERM / SIGINT.
 */
import 'reflect-metadata';

import { KeycloakIdentityAdmin } from '@itrms/integrations/api';
import { createWorkerContext } from '@itrms/kernel/api';
import { identitySyncHandlers, purgeExpiredUploads, startJobs, type OutboxHandler } from '@itrms/kernel/api/worker';
import { createDatabase } from '@itrms/kernel/db';
import { createSystemDatabase } from '@itrms/kernel/db/system';

import { AppModule } from './app.module';
import { objectStoreOf } from './object-store';
import { fail, start } from './start';

async function main() {
    const { config, logger } = start('worker');
    try {
        const database = createDatabase(config.DATABASE_URL, {
            applicationName: 'itrms-worker',
            auditKey: config.AUDIT_HMAC_KEY,
            onError: (err) => logger.warn({ err }, 'an idle database connection failed')
        });
        const background = Boolean(config.DATABASE_SYSTEM_URL && config.VALKEY_QUEUES_URL);
        // with background work the stop signal is handled here: the jobs stop before the database closes
        const objectStore = objectStoreOf(config);
        const app = await createWorkerContext(AppModule.forRoot(config, logger, { database, objectStore }), logger, {
            shutdownHooks: !background
        });

        if (background && config.DATABASE_SYSTEM_URL && config.VALKEY_QUEUES_URL) {
            // recurring uses (the relay, the sweeps) are counted and reported every ten minutes; the others one by one
            const recurring = new Map<string, number>();
            setInterval(() => {
                if (!recurring.size) return;
                logger.info({ uses: Object.fromEntries(recurring) }, 'system context: recurring uses');
                recurring.clear();
            }, 600_000).unref();
            const system = createSystemDatabase(config.DATABASE_SYSTEM_URL, {
                onUse: (reason, use) => {
                    if (use.recurring) recurring.set(reason, (recurring.get(reason) ?? 0) + 1);
                    else logger.info({ reason, ...use.detail }, 'system context');
                },
                onError: (err) => logger.warn({ err }, 'an idle system connection failed')
            });
            const handlers: Record<string, OutboxHandler> = {};
            // the identity provider follows the tree and the assignments, when the installation names its admin client
            if (config.KEYCLOAK_URL && config.KEYCLOAK_ADMIN_CLIENT_SECRET)
                Object.assign(
                    handlers,
                    identitySyncHandlers(
                        system,
                        new KeycloakIdentityAdmin({
                            url: config.KEYCLOAK_URL,
                            realm: config.KEYCLOAK_REALM,
                            clientId: config.KEYCLOAK_ADMIN_CLIENT_ID,
                            clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET
                        })
                    )
                );
            const url = new URL(config.VALKEY_QUEUES_URL);
            const jobs = startJobs({
                connection: {
                    host: url.hostname,
                    port: Number(url.port || 6379),
                    password: url.password ? decodeURIComponent(url.password) : undefined,
                    db: Number(url.pathname.slice(1) || 0),
                    tls: url.protocol === 'rediss:' ? {} : undefined,
                    // BullMQ's workers wait on blocking commands: no retry limit per request
                    maxRetriesPerRequest: null
                },
                system,
                handlers,
                logger,
                // uploads never confirmed, or refused, are removed after 24 hours (task 0.15)
                recurring: objectStore
                    ? [
                          {
                              name: 'files purged',
                              everyMs: 3_600_000,
                              run: () =>
                                  purgeExpiredUploads(system, objectStore, {
                                      onError: (err, what) => logger.warn({ err, what }, 'a file could not be purged')
                                  })
                          }
                      ]
                    : []
            });
            const stop = async (signal: string) => {
                logger.info({ signal }, 'worker stopping');
                try {
                    await jobs.stop();
                    await system.close();
                    await app.close();
                } catch (err) {
                    logger.error({ err }, 'the worker did not stop cleanly');
                    process.exitCode = 1;
                }
            };
            process.once('SIGTERM', () => void stop('SIGTERM'));
            process.once('SIGINT', () => void stop('SIGINT'));
            logger.info({ handlers: Object.keys(handlers) }, 'worker ready: relaying the outbox');
        } else {
            // no queues configured: an idle timer keeps the process alive until its stop signal
            setInterval(() => undefined, 60_000);
            logger.info('worker ready (no DATABASE_SYSTEM_URL or VALKEY_QUEUES_URL: no background work)');
        }
    } catch (error) {
        fail(logger, error);
    }
}

void main();
