/**
 * Seeds data files into the database, as the owner role, after the migrations:
 *   `node dist/seed.cjs org <file.yaml|.csv|.xlsx> [--region <code>]`   the org tree (`pnpm seed:org <file>`)
 *   `node dist/seed.cjs users <file.yaml>`                             users and their roles (`pnpm seed:users <file>`)
 * Both imports are idempotent, so a seed can run on every start; each file goes in in one transaction, and its writes are
 * audited with no actor (an installation step, not a person).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { createDatabase } from '@itrms/kernel/db';
import { importUsers, userImportSchema } from '@itrms/kernel/seed';
import { importOrg, parseOrgCsv, parseOrgWorkbook, parseOrgYaml, type OrgImport } from '@itrms/kernel/org';
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
    if ((kind !== 'org' && kind !== 'users') || !file)
        fail(
            logger,
            new Error('usage: seed org <file.yaml|file.csv|file.xlsx> [--region <code>] | seed users <file.yaml>')
        );

    const db = createDatabase(config.DATABASE_MIGRATE_URL, { max: 1, applicationName: 'itrms-seed' });
    try {
        const ctx = { requestId: `seed:${file}` };
        if (kind === 'org') {
            const doc = await readOrgFile(file, region);
            logger.info({ file, ...(await db.scoped(ctx, (tx) => importOrg(tx, doc))) }, 'org seed applied');
        } else {
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
