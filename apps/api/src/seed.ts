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
 *   `node dist/seed.cjs settings <file.yaml>`                       a region's settings, as a bureau would set them
 *   `node dist/seed.cjs identity`                                     org units → Keycloak groups, people → their units'
 *                                                                     groups (needs KEYCLOAK_URL and the admin client secret)
 * Several in one run, applied in order in one process: `node dist/seed.cjs org a.yaml --then users b.yaml`.
 * Both imports are idempotent, so a seed can run on every start; each file goes in in one transaction, and its writes are
 * audited with no actor (an installation step, not a person).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { KeycloakIdentityAdmin } from '@itrms/integrations/api';
import { createDatabase } from '@itrms/kernel/db';
import { syncIdentity } from '@itrms/kernel/iam';
import { importRegionSettings, importUsers, regionSettingsSchema, userImportSchema } from '@itrms/kernel/seed';
import { loadSlices } from '@itrms/kernel/api';
import { importOrg, orgUnits, parseOrgCsv, parseOrgWorkbook, parseOrgYaml, type OrgImport } from '@itrms/kernel/org';
import {
    importDemoData,
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

import { isSeedCommand, parseSeedCommands } from './seed-commands';
import { SLICES } from './slices';
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

const USAGE =
    'usage: seed org <file.yaml|file.csv|file.xlsx> [--region <code>] | seed users <file.yaml> | ' +
    'seed services <catalogue.yaml> --region <code> | seed fees <rules.yaml> --region <code> | ' +
    'seed counters --region <code> | seed competency --region <code> | seed demo --region <code> | seed settings <file.yaml> | seed identity' +
    ' (several in one run: <seed> --then <seed> …)';

type Started = ReturnType<typeof start<'migrate'>>;
type Database = ReturnType<typeof createDatabase>;

async function main() {
    const { config, logger } = start('migrate');
    // every command is checked before the first is applied
    const commands = parseSeedCommands(process.argv.slice(2));
    if (!commands.every(isSeedCommand)) fail(logger, new Error(USAGE));

    const db = createDatabase(config.DATABASE_MIGRATE_URL, {
        max: 1,
        applicationName: 'itrms-seed',
        ...(config.AUDIT_HMAC_KEY ? { auditKey: config.AUDIT_HMAC_KEY } : {})
    });
    try {
        // one process for a run's commands: on Windows a Node start alone takes seconds (demo:reset's limit)
        for (const command of commands) {
            const from = Date.now();
            await seedOne(db, config, logger, command);
            logger.info({ seed: command.join(' '), ms: Date.now() - from }, 'seed step done');
        }
    } catch (error) {
        fail(logger, error);
    } finally {
        await db.close();
    }
}

async function seedOne(db: Database, config: Started['config'], logger: Started['logger'], command: string[]) {
    const [kind, file, ...rest] = command;
    const regionAt = rest.indexOf('--region');
    const region = regionAt >= 0 ? rest[regionAt + 1] : undefined;
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
    } else if (kind === 'settings' && file) {
        // a region's settings from a data file, checked against the slices' schemas (task 0.25b)
        const doc = regionSettingsSchema.parse(parseYaml(await readFile(file, 'utf8')));
        // the settings of the modules this installation runs, as the API's own registry has them
        const { settings: registry } = loadSlices(SLICES, { disabled: config.MODULES_DISABLED });
        const root = await db.scoped(ctx, async (tx) => {
            const [found] = await tx
                .select()
                .from(orgUnits)
                .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, doc.region)));
            if (!found) throw new Error(`no region ${doc.region}`);
            return found;
        });
        // on the record as set in the region, like a bureau's own change
        const made = await db.scoped({ ...ctx, regionId: root.regionId, unitId: root.id, scopePath: root.path }, (tx) =>
            importRegionSettings(tx, root, doc.settings, registry)
        );
        logger.info({ region: doc.region, settings: made }, 'the region settings applied');
    } else if (kind === 'demo') {
        // the demo's generated people and licences (task 0.25a): registered as the API would, so their sensitive fields are encrypted
        const code = file === '--region' ? rest[0] : region;
        if (!code) throw new Error('seed demo needs --region <code>');
        if (!config.FIELD_KEYS || !config.BLIND_INDEX_KEY || !config.AUDIT_HMAC_KEY)
            throw new Error('seed demo needs FIELD_KEYS, BLIND_INDEX_KEY and AUDIT_HMAC_KEY: it writes personal data');
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
}

void main();
