/**
 * Seeds data files into the database, as the owner role, after the migrations:
 *   `node dist/seed.cjs org <file.yaml|.csv|.xlsx> [--region <code>]`   the org tree (`pnpm seed:org <file>`)
 *   `node dist/seed.cjs users <file.yaml>`                             users and their roles (`pnpm seed:users <file>`)
 *   `node dist/seed.cjs services <catalogue.yaml> --region <code>`     a region's service catalogue (`pnpm seed:services`;
 *                                                                     platform/services/seed/catalogue.yaml)
 *   `node dist/seed.cjs fees <rules.yaml> --region <code>`            a region's fee rules, approved as an installation step
 *                                                                     (`pnpm seed:fees`; modules/competency/seed/fee-rules.demo.yaml)
 *   `node dist/seed.cjs documents --region <code>`                   the region's document templates (`pnpm seed:documents`)
 *   `node dist/seed.cjs counters --region <code>`                    the receipt counters of the region's offices that
 *                                                                     collect cash (`pnpm seed:counters`; again when an
 *                                                                     office is added)
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
import {
    importDemoData,
    importSecondRegionDemo,
    importLicenceGrades,
    importLicenceServices,
    setUpLicenceCounters
} from '@itrms/competency/seed';
import { FieldCrypto } from '@itrms/kernel/crypto';
import { OrganisationsService, PersonsService } from '@itrms/parties/api';
import { importDocumentTemplates } from '@itrms/documents/seed';
import { importFeeRules, parseFeeRules, setUpReceiptCounters } from '@itrms/fees/seed';
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
    if (!(
        kind === 'identity' ||
        kind === 'counters' ||
        kind === 'documents' ||
        kind === 'competency' ||
        kind === 'demo' ||
        kind === 'demo-city' ||
        ((kind === 'org' || kind === 'users' || kind === 'services' || kind === 'fees') && file)
    ))
        fail(
            logger,
            new Error(
                'usage: seed org <file.yaml|file.csv|file.xlsx> [--region <code>] | seed users <file.yaml> | ' +
                    'seed services <catalogue.yaml> --region <code> | seed fees <rules.yaml> --region <code> | ' +
                    'seed counters --region <code> | seed competency --region <code> | seed demo --region <code> | seed demo-city --region <code> | seed identity'
            )
        );

    const db = createDatabase(config.DATABASE_MIGRATE_URL, {
        max: 1,
        applicationName: 'itrms-seed',
        ...(config.AUDIT_HMAC_KEY ? { auditKey: config.AUDIT_HMAC_KEY } : {})
    });
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
        } else if (kind === 'documents') {
            const code = file === '--region' ? rest[0] : region;
            if (!code) throw new Error('seed documents needs --region <code>');
            const stored = await db.scoped(ctx, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
                if (!root) throw new Error(`no region ${code}`);
                return importDocumentTemplates(tx, { id: root.id, regionId: root.regionId });
            });
            logger.info({ region: code, stored }, 'document templates applied');
        } else if (kind === 'counters') {
            const code = file === '--region' ? rest[0] : region;
            if (!code) throw new Error('seed counters needs --region <code>');
            const offices = await db.scoped(ctx, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
                if (!root) throw new Error(`no region ${code}`);
                return setUpReceiptCounters(tx, root.regionId);
            });
            logger.info({ region: code, offices }, 'receipt counters set up');
        } else if (kind === 'fees' && file) {
            if (!region) throw new Error('seed fees needs --region <code>');
            const rules = parseFeeRules(await readFile(file, 'utf8'));
            const stored = await db.scoped(ctx, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, region)));
                if (!root) throw new Error(`no region ${region}`);
                return importFeeRules(tx, { id: root.id, regionId: root.regionId }, rules);
            });
            logger.info({ file, region, rules: rules.length, stored }, 'fee rules applied');
        } else if (kind === 'competency') {
            // the catalogue of licence grades and the offices' licence counters (task 0.24a)
            const code = file === '--region' ? rest[0] : region;
            if (!code) throw new Error('seed competency needs --region <code>');
            const result = await db.scoped(ctx, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, code)));
                if (!root) throw new Error(`no region ${code}`);
                const where = { id: root.id, regionId: root.regionId };
                return {
                    grades: await importLicenceGrades(tx, where),
                    counters: await setUpLicenceCounters(tx, root.regionId),
                    // after the catalogue and the fee rules (task 0.24b)
                    services: await importLicenceServices(tx, where)
                };
            });
            logger.info({ region: code, ...result }, 'licence grades, counters and services applied');
        } else if (kind === 'demo-city') {
            // the second demo region's branding and languages (task 0.25b)
            const code = file === '--region' ? rest[0] : region;
            if (!code) throw new Error('seed demo-city needs --region <code>');
            logger.info(
                { region: code, settings: await importSecondRegionDemo(db, code) },
                'the second region applied'
            );
        } else if (kind === 'demo') {
            // the demo's generated people and licences (task 0.25a): registered as the API would, so their sensitive fields are encrypted
            const code = file === '--region' ? rest[0] : region;
            if (!code) throw new Error('seed demo needs --region <code>');
            if (!config.FIELD_KEYS || !config.BLIND_INDEX_KEY || !config.AUDIT_HMAC_KEY)
                throw new Error(
                    'seed demo needs FIELD_KEYS, BLIND_INDEX_KEY and AUDIT_HMAC_KEY: it writes personal data'
                );
            const persons = new PersonsService(
                db,
                new FieldCrypto({ fieldKeys: config.FIELD_KEYS, blindIndexKey: config.BLIND_INDEX_KEY })
            );
            const made = await importDemoData(db, code, {
                persons,
                organisations: new OrganisationsService(persons)
            });
            logger.info({ region: code, ...made }, made ? 'demo data applied' : 'the demo data was already there');
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
