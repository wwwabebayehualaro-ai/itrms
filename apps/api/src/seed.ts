/**
 * Seeds data files into the database, as the owner role, after the migrations:
 *   `node dist/seed.cjs org <file.yaml|.csv|.xlsx> [--region <code>]`   the org tree (`pnpm seed:org <file>`)
 *   `node dist/seed.cjs users <file.yaml>`                             users and their roles (`pnpm seed:users <file>`)
 *   `node dist/seed.cjs services <catalogue.yaml> --region <code>`     a region's service catalogue (`pnpm seed:services`;
 *                                                                     platform/services/seed/catalogue.yaml)
 *   `node dist/seed.cjs identity`                                     org units → Keycloak groups, people → their units'
 *                                                                     groups (needs KEYCLOAK_URL and the admin client secret)
 * Both imports are idempotent, so a seed can run on every start; each file goes in in one transaction, and its writes are
 * audited with no actor (an installation step, not a person).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { KeycloakIdentityAdmin } from '@itrms/integrations/api';
import { createDatabase } from '@itrms/kernel/db';
import { syncIdentity } from '@itrms/kernel/iam';
import { importUsers, userImportSchema } from '@itrms/kernel/seed';
import { importOrg, orgUnits, parseOrgCsv, parseOrgWorkbook, parseOrgYaml, type OrgImport } from '@itrms/kernel/org';
import { importCatalogue } from '@itrms/services/api';
import { parseCatalogue } from '@itrms/services/seed';
import { and, eq, isNull } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';

import { fail, start } from './start';

async function readOrgFile(file: string, region: string | undefined): Promise<OrgImport> {
    const extension = extname(file).toLowerCase();
    if (extension === '.yaml' || extension === '.yml') return parseOrgYaml(await readFile(file, 'utf8'));
    if (!region) throw new Error(`${file}: a CSV or Excel file needs --region <code>`);
    if (extension === '.csv') return parseOrgCsv(await readFile(file, 'utf8'), region);
    if (extension === '.xlsx') {
        const data = await readFile(file);
        return parseOrgWorkbook(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), region);
    }
    throw new Error(`${file}: not a .yaml, .csv or .xlsx file`);
}

async function main() {
    const { config, logger } = start('migrate');
    const [kind, file, ...rest] = process.argv.slice(2);
    const regionAt = rest.indexOf('--region');
    const region = regionAt >= 0 ? rest[regionAt + 1] : undefined;
    if (!(kind === 'identity' || ((kind === 'org' || kind === 'users' || kind === 'services') && file)))
        fail(
            logger,
            new Error(
                'usage: seed org <file.yaml|file.csv|file.xlsx> [--region <code>] | seed users <file.yaml> | ' +
                    'seed services <catalogue.yaml> --region <code> | seed identity'
            )
        );

    const db = createDatabase(config.DATABASE_MIGRATE_URL, { max: 1, applicationName: 'itrms-seed' });
    try {
        const ctx = { requestId: `seed:${file ?? kind}` };
        if (kind === 'identity') {
            if (!config.KEYCLOAK_URL || !config.KEYCLOAK_ADMIN_CLIENT_SECRET)
                throw new Error('seed identity needs KEYCLOAK_URL and KEYCLOAK_ADMIN_CLIENT_SECRET');
            const admin = new KeycloakIdentityAdmin({
                url: config.KEYCLOAK_URL,
                realm: config.KEYCLOAK_REALM,
                clientId: config.KEYCLOAK_ADMIN_CLIENT_ID,
                clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET
            });
            logger.info(await db.scoped(ctx, (tx) => syncIdentity(tx, admin)), 'identity provider in sync');
        } else if (kind === 'org' && file) {
            const doc = await readOrgFile(file, region);
            logger.info({ file, ...(await db.scoped(ctx, (tx) => importOrg(tx, doc))) }, 'org seed applied');
        } else if (kind === 'services' && file) {
            if (!region) throw new Error('seed services needs --region <code>');
            const services = parseCatalogue(await readFile(file, 'utf8'));
            const changed = await db.scoped(ctx, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, region)));
                if (!root) throw new Error(`no region ${region}`);
                return importCatalogue(tx, root.id, services);
            });
            logger.info({ file, region, services: services.length, changed }, 'service catalogue applied');
        } else if (file) {
            const doc = userImportSchema.parse(parseYaml(await readFile(file, 'utf8')));
            logger.info({ file, ...(await db.scoped(ctx, (tx) => importUsers(tx, doc))) }, 'users seed applied');
        }
    } catch (error) {
        fail(logger, error);
    } finally {
        await db.close();
    }
}

void main();
