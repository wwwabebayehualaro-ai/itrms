// drizzle-kit (ADR-0003, tech-stack T25a): one migration history for the installation, from every slice's *.table.ts.
//   pnpm --filter @itrms/api db:generate            a migration from the schema change (review the SQL, then commit it)
//   pnpm --filter @itrms/api db:generate --custom   an empty one for hand-written SQL (triggers, grants, policies)
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: ['../../platform/*/api/**/*.table.ts', '../../modules/*/api/**/*.table.ts'],
    out: './drizzle',
    migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
    // only for drizzle-kit commands that talk to a database (generate does not)
    dbCredentials: { url: process.env.DATABASE_MIGRATE_URL ?? 'postgres://itrms_owner@localhost:15432/itrms' }
});
