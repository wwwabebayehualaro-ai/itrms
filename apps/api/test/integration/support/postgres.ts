/**
 * A PostgreSQL 16 for an integration test file: the dev stack's image in a container, the role bootstrap as a superuser
 * (passwords on stdin, never a command line) and the migration history from zero as the owner, as an installation would.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROLES_SQL } from '@itrms/kernel/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// the dev stack's image (infra/compose/docker-compose.yml)
export const IMAGE =
    'postgres:16.15-alpine3.23@sha256:621a761097839bdb50207afd6b87a72f38e2d718dd46c3d744828d8917c4f1e0';
export const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle');

export const password = () => randomBytes(12).toString('hex');

export type Role = 'owner' | 'app' | 'system' | 'backup';

export interface TestPostgres {
    container: StartedPostgreSqlContainer;
    passwords: Record<Role, string>;
    /** A connection URL for `itrms_<role>`. */
    url(role: Role): string;
    stop(): Promise<void>;
}

export async function startPostgres(): Promise<TestPostgres> {
    const passwords: Record<Role, string> = {
        owner: password(),
        app: password(),
        system: password(),
        backup: password()
    };
    const container = await new PostgreSqlContainer(IMAGE).withDatabase('itrms').withPassword(password()).start();
    const url = (role: Role) =>
        `postgres://itrms_${role}:${passwords[role]}@${container.getHost()}:${container.getMappedPort(5432)}/itrms`;

    const bootstrap =
        Object.entries(passwords)
            .map(([role, pw]) => `\\set ${role}_password '${pw}'\n`)
            .join('') + readFileSync(ROLES_SQL, 'utf8');
    await container.copyContentToContainer([{ content: bootstrap, target: '/tmp/roles.psql' }]);
    const result = await container.exec(
        ['psql', '-v', 'ON_ERROR_STOP=1', '-U', container.getUsername(), '-d', 'itrms', '-f', '/tmp/roles.psql'],
        { user: 'postgres' }
    );
    if (result.exitCode !== 0) throw new Error(`roles.psql failed: ${result.output}`);

    const migrator = new Pool({ connectionString: url('owner') });
    try {
        await migrate(drizzle(migrator), {
            migrationsFolder: MIGRATIONS,
            migrationsSchema: 'drizzle',
            migrationsTable: '__drizzle_migrations'
        });
    } finally {
        await migrator.end();
    }
    return { container, passwords, url, stop: async () => void (await container.stop()) };
}
