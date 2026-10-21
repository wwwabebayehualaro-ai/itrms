/**
 * The org tree on a real PostgreSQL 16 (task 0.8): the Wolaita seed, depth variants (a region without zones, a city with
 * sub-cities and kebeles), path triggers on moves, the GiST index for subtree queries, level names from the region's own
 * definitions, effective services with a unit override, import of a second zone from YAML, CSV and Excel, and the admin
 * API's scope and permission checks.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Module, type DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHttpApp, createLogger, KernelModule } from '@itrms/kernel/api';
import { loadConfig } from '@itrms/kernel/config';
import { auditLog, createDatabase, type Database, type Tx } from '@itrms/kernel/db';
import type { Authenticator, Principal } from '@itrms/kernel/iam';
import {
    createUnit,
    describeUnit,
    effectiveServices,
    findUnitByCode,
    importOrg,
    moveUnit,
    parseOrgCsv,
    parseOrgWorkbook,
    parseOrgYaml,
    orgUnits,
    setServiceOverride,
    clearServiceOverride,
    subtree,
    type OrgUnit
} from '@itrms/kernel/org';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, '..', '..', 'seed', 'org', 'south-ethiopia.wolaita.yaml');
const FIXTURES = join(HERE, '..', 'fixtures', 'org');
const yamlOf = (file: string) => parseOrgYaml(readFileSync(file, 'utf8'));

let pg: TestPostgres;
let installer: Database; // the owner, as the seed command runs
let app: Database; // itrms_app, as the API runs
let owner: Client;

const ctx = { requestId: 'org-test' };
const asInstaller = <T>(fn: (tx: Tx) => Promise<T>) => installer.scoped(ctx, fn);
const unit = async (regionCode: string, code: string): Promise<OrgUnit> =>
    asInstaller(async (tx) => {
        const [region] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, regionCode)));
        const found = region && (await findUnitByCode(tx, region.id, code));
        if (!found) throw new Error(`no unit ${code}`);
        return found;
    });

beforeAll(async () => {
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    app = createDatabase(pg.url('app'));
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
}, 240_000);

afterAll(async () => {
    await installer?.close();
    await app?.close();
    await owner?.end();
    await pg?.stop();
});

describe('the Wolaita seed', () => {
    it('creates the region, the zone, its 16 woredas and 8 towns, with levels and unit types; again changes nothing', async () => {
        const first = await asInstaller((tx) => importOrg(tx, yamlOf(SEED)));
        expect(first.created).toEqual({ levels: 4, unitTypes: 6, units: 26 });

        const zone = await unit('SER', 'WOL');
        const below = await asInstaller((tx) => subtree(tx, zone.path));
        expect(below.filter((u) => u.kind === 'woreda')).toHaveLength(16);
        expect(below.filter((u) => u.levelKey === 'town')).toHaveLength(8);
        expect(below.every((u) => u.parentId === zone.id || u.id === zone.id)).toBe(true);

        const again = await asInstaller((tx) => importOrg(tx, yamlOf(SEED)));
        expect(again.created).toEqual({ levels: 0, unitTypes: 0, units: 0 });
    });

    it('keeps the known categories and grades, and marks what the zone must confirm', async () => {
        expect((await unit('SER', 'WOL-DAMOT-GALE')).category).toBe('m1');
        expect((await unit('SER', 'WOL-BODITI')).category).toBe('f1');
        expect((await unit('SER', 'WOL-GESUBA')).category).toBe('f3');
        expect((await unit('SER', 'WOL-BITENA')).category).toBe('f4');
        expect((await unit('SER', 'WOL-HUMBO')).toConfirm).toEqual(
            expect.arrayContaining(['name.am', 'category', 'unit_type'])
        );
    });

    it("creates each unit's teams from its type (Form 15)", async () => {
        const boditi = await unit('SER', 'WOL-BODITI');
        const { rows } = await owner.query<{ key: string }>(
            'select key from kernel.org_departments where org_unit_id = $1 order by key',
            [boditi.id]
        );
        expect(rows.map((r) => r.key)).toEqual(['competency', 'freight', 'public_transport', 'road_safety']);
    });
});

describe('effective services', () => {
    it('include DVC-03 at Boditi and not at Damot Gale; an override changes that for one unit only', async () => {
        const boditi = await unit('SER', 'WOL-BODITI');
        const damotGale = await unit('SER', 'WOL-DAMOT-GALE');
        const humbo = await unit('SER', 'WOL-HUMBO');
        const services = (u: OrgUnit) => asInstaller((tx) => effectiveServices(tx, u.id));

        expect(await services(boditi)).toContain('DVC-03');
        expect(await services(damotGale)).not.toContain('DVC-03');
        expect(await services(damotGale)).toContain('RQ-01');

        await asInstaller((tx) =>
            setServiceOverride(tx, damotGale.id, 'DVC-03', true, 'licences issued here by agreement')
        );
        expect(await services(damotGale)).toContain('DVC-03');
        expect(await services(humbo)).not.toContain('DVC-03');

        await asInstaller((tx) => setServiceOverride(tx, boditi.id, 'FR-01', false, 'no freight team yet'));
        expect(await services(boditi)).not.toContain('FR-01');

        await asInstaller((tx) => clearServiceOverride(tx, damotGale.id, 'DVC-03'));
        expect(await services(damotGale)).not.toContain('DVC-03');
    });
});

describe('levels and depth', () => {
    it("name a unit's level in its region's own words", async () => {
        await asInstaller((tx) => importOrg(tx, yamlOf(join(FIXTURES, 'region-without-zones.yaml'))));
        const damotGale = await asInstaller(async (tx) => describeUnit(tx, await unit('SER', 'WOL-DAMOT-GALE')));
        const district = await asInstaller(async (tx) => describeUnit(tx, await unit('TRX', 'TRX-W1')));
        expect(damotGale.level.name).toMatchObject({ en: 'Woreda', am: 'ወረዳ' });
        expect(district.level.name).toMatchObject({ en: 'District' });
        expect(damotGale.capabilities).toEqual([]);
        const boditi = await asInstaller(async (tx) => describeUnit(tx, await unit('SER', 'WOL-BODITI')));
        expect(boditi.capabilities).toContain('runs_terminal');
    });

    it('allow 3 levels (region > zone > woreda), 2 (region > district) and a city with sub-cities and kebeles', async () => {
        const depth = (u: OrgUnit) => u.path.split('.').length;
        expect(depth(await unit('SER', 'WOL-DAMOT-GALE'))).toBe(3);
        expect(depth(await unit('TRX', 'TRX-W1'))).toBe(2);
        expect(depth(await unit('TRX', 'TRX-CITY-S1'))).toBe(3);
        expect(depth(await unit('TRX', 'TRX-CITY-S1-K1'))).toBe(4);
    });

    it("refuse a level that does not rank below the parent's, and a type of another level", async () => {
        const city = await unit('TRX', 'TRX-CITY');
        await expect(
            asInstaller((tx) =>
                createUnit(tx, {
                    parentId: city.id,
                    kind: 'city_admin',
                    levelKey: 'city',
                    code: 'TRX-BAD',
                    name: { am: 'ስህተት', en: 'Wrong' }
                })
            )
        ).rejects.toMatchObject({ status: 422, errors: [{ path: 'level', code: 'level_not_below_parent' }] });
    });
});

describe('the path triggers', () => {
    it('rewrite the subtree when a unit moves, and audit the move', async () => {
        const region = await unit('TRX', 'TRX');
        const cityB = await asInstaller((tx) =>
            createUnit(tx, {
                parentId: region.id,
                kind: 'city_admin',
                levelKey: 'city',
                code: 'TRX-CITY-B',
                name: { am: 'ከተማ ለ', en: 'City B' }
            })
        );
        const s1 = await unit('TRX', 'TRX-CITY-S1');
        const moved = await asInstaller((tx) => moveUnit(tx, s1.id, s1.rowVersion, cityB.id));
        expect(moved.path).toBe(`${cityB.path}.${s1.path.split('.').at(-1)}`);
        const kebele = await unit('TRX', 'TRX-CITY-S1-K1');
        expect(kebele.path.startsWith(`${moved.path}.`)).toBe(true);
        expect(kebele.parentId).toBe(s1.id);

        const audit = await drizzle(owner)
            .select()
            .from(auditLog)
            .where(eq(auditLog.rowId, s1.id))
            .orderBy(auditLog.at);
        expect(audit.map((a) => a.action)).toEqual(['insert', 'update', 'event']);
        expect(audit[2]).toMatchObject({ eventType: 'org.unit_moved', diff: { descendants: 1, toParentId: cityB.id } });
    });

    it('refuse a move under itself, a direct path write and a change of region', async () => {
        const city = await unit('TRX', 'TRX-CITY');
        const s2 = await unit('TRX', 'TRX-CITY-S2');
        await expect(
            owner.query('update kernel.org_units set parent_id = $1 where id = $2', [s2.id, city.id])
        ).rejects.toThrow(/cannot move under itself/);
        await expect(owner.query("update kernel.org_units set path = 'x.y' where id = $1", [s2.id])).rejects.toThrow(
            /path is kept by the tree/
        );
        const ser = await unit('SER', 'SER');
        await expect(
            owner.query('update kernel.org_units set region_id = $1 where id = $2', [ser.id, s2.id])
        ).rejects.toThrow(/never changes region/);
    });

    it('keep regions at the root, active parents above active units, and the API off the structural columns', async () => {
        const city = await unit('TRX', 'TRX-CITY');
        await expect(
            owner.query(
                `insert into kernel.org_units (id, region_id, parent_id, kind, level_key, code, name)
                 values (gen_random_uuid(), $1, $2, 'region', 'sub_city', 'TRX-FAKE', '{"am":"ሀ","en":"A"}')`,
                [city.regionId, city.id]
            )
        ).rejects.toThrow(/org_units_region_kind_check/);
        await expect(
            owner.query('update kernel.org_units set active = false where id = $1', [city.id])
        ).rejects.toThrow(/deactivate the units below it first/);
        const app_ = new Client({ connectionString: pg.url('app') });
        await app_.connect();
        try {
            await expect(
                app_.query("update kernel.org_units set level_key = 'kebele' where id = $1", [city.id])
            ).rejects.toMatchObject({ code: '42501' });
            await expect(
                app_.query('update kernel.org_level_definitions set rank = 9 where region_id = $1', [city.regionId])
            ).rejects.toMatchObject({ code: '42501' });
        } finally {
            await app_.end();
        }
    });

    it('serve a subtree query from the GiST index', async () => {
        const s2 = await unit('TRX', 'TRX-CITY-S2');
        // enough rows that the planner prefers the index to a scan
        await owner.query(
            `insert into kernel.org_units (id, region_id, parent_id, kind, level_key, code, name)
             select gen_random_uuid(), $1, $2, 'kebele', 'kebele', 'TRX-K' || n, '{"am":"ቀ","en":"K"}'
             from generate_series(1, 5000) n`,
            [s2.regionId, s2.id]
        );
        await owner.query('analyze kernel.org_units');
        const zone = await unit('SER', 'WOL');
        const { rows } = await owner.query<{ 'QUERY PLAN': string }>(
            `explain select id from kernel.org_units where path <@ $1::ltree`,
            [zone.path]
        );
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        process.stdout.write(`EXPLAIN subtree of Wolaita Zone:\n${plan}\n`);
        expect(plan).toContain('org_units_path_gist');
    });
});

describe('importing a second zone', () => {
    it('from YAML creates its units and types with no code change, parents in any order', async () => {
        const result = await asInstaller((tx) => importOrg(tx, yamlOf(join(FIXTURES, 'test-zone-b.yaml'))));
        expect(result.created).toEqual({ levels: 0, unitTypes: 2, units: 3 });
        const w1 = await unit('SER', 'TZB-W1');
        const zone = await unit('SER', 'TZB');
        expect(w1.parentId).toBe(zone.id);
        expect(w1.category).toBe('m2');
        expect(await asInstaller((tx) => effectiveServices(tx, w1.id))).toEqual(['CP-01', 'CP-02', 'RS-01']);
    });

    it('from CSV and from Excel adds units under it', async () => {
        const csv = [
            'code,parent,kind,level,type,category,name_am,name_en,name_wal-latn,to_confirm',
            'TZB-W3,TZB,woreda,woreda,tzb_woreda_desk,m2,"ወረዳ 3, የሙከራ",Test Woreda 3,Test Woreda 3,name.am;category'
        ].join('\r\n');
        await asInstaller((tx) => importOrg(tx, parseOrgCsv(csv, 'SER')));
        const w3 = await unit('SER', 'TZB-W3');
        expect(w3.name).toEqual({ am: 'ወረዳ 3, የሙከራ', en: 'Test Woreda 3', 'wal-Latn': 'Test Woreda 3' });
        expect(w3.toConfirm).toEqual(['name.am', 'category']);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('units');
        sheet.addRow(['code', 'parent', 'kind', 'level', 'type', 'name_am', 'name_en']);
        sheet.addRow(['TZB-W4', 'TZB', 'woreda', 'woreda', 'tzb_woreda_desk', 'ወረዳ 4', 'Test Woreda 4']);
        const data = await workbook.xlsx.writeBuffer();
        await asInstaller(async (tx) => importOrg(tx, await parseOrgWorkbook(data, 'SER')));
        expect((await unit('SER', 'TZB-W4')).name).toEqual({ am: 'ወረዳ 4', en: 'Test Woreda 4' });
    });

    it('refuses a file with an error as a whole, saying where', async () => {
        const csv =
            'code,parent,kind,level,name_am,name_en\nTZB-W5,TZB,woreda,woreda,ወ,W5\nTZB-W6,NOPE,woreda,woreda,ወ,W6';
        await expect(asInstaller((tx) => importOrg(tx, parseOrgCsv(csv, 'SER')))).rejects.toMatchObject({
            status: 422,
            errors: [{ path: 'units.1.parent', code: 'unknown_parent' }]
        });
        const { rows } = await owner.query("select 1 from kernel.org_units where code = 'TZB-W5'");
        expect(rows).toHaveLength(0);
    });
});

describe('the admin API', () => {
    let http: NestFastifyApplication;
    let principal: Principal | undefined;
    const authenticator: Authenticator = { authenticate: () => Promise.resolve(principal) };
    const all = new Set([
        'org-unit:read',
        'org-unit:create',
        'org-unit:update',
        'org-unit:move',
        'org-unit:deactivate',
        'service-config:update'
    ]);

    beforeAll(async () => {
        const config = loadConfig('http', { DATABASE_URL: pg.url('app') });
        const logger = createLogger(config, new Writable({ write: (_c, _e, done) => done() }));
        @Module({})
        class Root {
            static forRoot(): DynamicModule {
                // a database of its own: the app closes it at shutdown
                const database = createDatabase(config.DATABASE_URL);
                return { module: Root, imports: [KernelModule.forRoot(config, logger, { database, authenticator })] };
            }
        }
        http = await createHttpApp(Root.forRoot(), config, logger);
        await http.init();
        await http.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
        await http?.close();
    });

    const actAt = async (regionCode: string, code: string, permissions = all) => {
        const u = await unit(regionCode, code);
        principal = {
            userId: '0199f0a0-0000-7000-8000-0000000000aa',
            unitId: u.id,
            regionId: u.regionId,
            scopePath: u.path,
            roles: ['unit_admin'],
            permissions
        };
    };
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: object, headers = {}) =>
        http.getHttpAdapter().getInstance().inject({ method, url, payload: body, headers });

    it('answers 401 to nobody and 403 without the permission', async () => {
        const boditi = await unit('SER', 'WOL-BODITI');
        principal = undefined;
        expect((await call('GET', `/api/v1/org-units/${boditi.id}`)).statusCode).toBe(401);
        await actAt('SER', 'WOL', new Set(['org-unit:read']));
        expect(
            (await call('POST', `/api/v1/org-units/${boditi.id}/deactivations`, undefined, { 'if-match': '1' }))
                .statusCode
        ).toBe(403);
    });

    it('shows a unit in scope with its level name, and answers 404 outside the scope', async () => {
        await actAt('SER', 'WOL');
        const boditi = await unit('SER', 'WOL-BODITI');
        const res = await call('GET', `/api/v1/org-units/${boditi.id}`);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            code: 'WOL-BODITI',
            level: { key: 'town', name: { en: 'Town administration' } }
        });

        const other = await unit('TRX', 'TRX-W1');
        expect((await call('GET', `/api/v1/org-units/${other.id}`)).statusCode).toBe(404);
        await actAt('SER', 'WOL-DAMOT-GALE');
        expect((await call('GET', `/api/v1/org-units/${boditi.id}`)).statusCode).toBe(404);
    });

    it("creates, renames (If-Match), moves and deactivates within the scope, and not the person's own unit", async () => {
        await actAt('SER', 'WOL');
        const zone = await unit('SER', 'WOL');
        const created = await call('POST', '/api/v1/org-units', {
            parentId: zone.id,
            kind: 'town_admin',
            levelKey: 'town',
            code: 'WOL-NEW-TOWN',
            name: { am: 'አዲስ ከተማ', en: 'New Town' }
        });
        expect(created.statusCode).toBe(201);
        const id = created.json<{ id: string }>().id;

        expect(
            (await call('PATCH', `/api/v1/org-units/${id}`, { name: { am: 'አዲስ', en: 'Renamed' } })).statusCode
        ).toBe(400);
        const renamed = await call(
            'PATCH',
            `/api/v1/org-units/${id}`,
            { name: { am: 'አዲስ', en: 'Renamed' } },
            { 'if-match': '"1"' }
        );
        expect(renamed.json()).toMatchObject({ name: { en: 'Renamed' }, version: 2 });
        expect(
            (await call('PATCH', `/api/v1/org-units/${id}`, { name: { am: 'ሀ', en: 'Again' } }, { 'if-match': '1' }))
                .statusCode
        ).toBe(409);

        const deactivated = await call('POST', `/api/v1/org-units/${id}/deactivations`, undefined, { 'if-match': '2' });
        expect(deactivated.json()).toMatchObject({ active: false });

        expect(
            (
                await call('POST', `/api/v1/org-units/${zone.id}/deactivations`, undefined, {
                    'if-match': String(zone.rowVersion)
                })
            ).statusCode
        ).toBe(403);
    });

    it('turns a service on for one unit, with a reason', async () => {
        await actAt('SER', 'WOL');
        const humbo = await unit('SER', 'WOL-HUMBO');
        const res = await call('PUT', `/api/v1/org-units/${humbo.id}/services/DVC-03`, {
            enabled: true,
            reason: 'pilot'
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<{ services: string[] }>().services).toContain('DVC-03');
        const { rows } = await owner.query(
            "select 1 from kernel.audit_log where table_name = 'kernel.unit_service_overrides' and actor_id = $1",
            [principal?.userId]
        );
        expect(rows.length).toBeGreaterThan(0);
        expect((await call('DELETE', `/api/v1/org-units/${humbo.id}/services/DVC-03`)).json()).toMatchObject({
            services: expect.not.arrayContaining(['DVC-03']) as unknown
        });

        // a unit never widens its own services
        await actAt('SER', 'WOL-HUMBO');
        const own = await call('PUT', `/api/v1/org-units/${humbo.id}/services/DVC-03`, {
            enabled: true,
            reason: 'self'
        });
        expect(own.statusCode).toBe(403);
    });
});
