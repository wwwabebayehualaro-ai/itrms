/**
 * The isolation matrix (task 0.9, architecture.md §5): every RLS class read and written as a person of one unit, against
 * rows at the unit itself, its child, parent and sibling, a unit of another zone and one of another region, and once with
 * no context on a connection that has just served a scoped transaction. Then every tenant table in the database is
 * checked to be declared (`withRls`), to have RLS on and to carry exactly its class's policies: a new tenant table
 * without policies fails this suite.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase, declaredRlsTables, type Database, type Tx } from '@itrms/kernel/db';
import { createSystemDatabase } from '@itrms/kernel/db/system';
import { findUnitByCode, importOrg, moveUnit, orgUnits, parseOrgYaml, type OrgUnit } from '@itrms/kernel/org';
import {
    asUnit,
    contextFor,
    ISOLATION_CASES,
    POLICIES,
    VISIBLE,
    WRITABLE,
    type IsolationCase
} from '@itrms/kernel/testing';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgres, type TestPostgres } from './support/postgres';

// every slice's table files: loading them registers their withRls() declarations, which the last tests check
import.meta.glob(['../../../../platform/*/api/**/*.table.ts', '../../../../modules/*/api/**/*.table.ts'], {
    eager: true
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG_FILES = [
    join(HERE, '..', '..', 'seed', 'org', 'south-ethiopia.wolaita.yaml'),
    join(HERE, '..', 'fixtures', 'org', 'test-zone-b.yaml'),
    join(HERE, '..', 'fixtures', 'org', 'region-without-zones.yaml')
];

/** Where each case's row lives, relative to the acting unit (Wolaita Zone). */
const CASE_UNITS: Record<IsolationCase, [region: string, code: string]> = {
    own: ['SER', 'WOL'],
    child: ['SER', 'WOL-BODITI'],
    parent: ['SER', 'SER'],
    sibling: ['SER', 'TZB'],
    otherZone: ['SER', 'TZB-W1'],
    otherRegion: ['TRX', 'TRX-W1']
};

let pg: TestPostgres;
let installer: Database;
let app: Database;
let owner: Client;
const units = {} as Record<IsolationCase, OrgUnit>;

async function unitAt(region: string, code: string): Promise<OrgUnit> {
    return installer.scoped({}, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, region)));
        const found = root && (await findUnitByCode(tx, root.id, code));
        if (!found) throw new Error(`no unit ${code}`);
        return found;
    });
}

beforeAll(async () => {
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    // one connection: the "no context" case runs on the connection the scoped cases used
    app = createDatabase(pg.url('app'), { max: 1 });
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    for (const file of ORG_FILES)
        await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(file, 'utf8'))));
    for (const c of ISOLATION_CASES) units[c] = await unitAt(...CASE_UNITS[c]);

    // one sample table per class, as a slice's migration creates it: region, scope column kept by trigger, policies
    await owner.query(`
        CREATE SCHEMA sample;
        GRANT USAGE ON SCHEMA sample TO itrms_app;
        CREATE TABLE sample.t_rows (id serial PRIMARY KEY, label text NOT NULL, region_id uuid NOT NULL,
            handling_unit_id uuid NOT NULL, org_path ltree NOT NULL DEFAULT '');
        CREATE TABLE sample.c_rows (LIKE sample.t_rows INCLUDING ALL);
        CREATE TABLE sample.r_rows (id serial PRIMARY KEY, label text NOT NULL, region_id uuid NOT NULL,
            handling_unit_id uuid NOT NULL, handling_org_path ltree NOT NULL DEFAULT '');
        CREATE TABLE sample.p_rows (id serial PRIMARY KEY, label text NOT NULL, region_id uuid NOT NULL, party_id uuid NOT NULL);
        CREATE TRIGGER set_org_path BEFORE INSERT OR UPDATE ON sample.t_rows
            FOR EACH ROW EXECUTE FUNCTION kernel.set_org_path('handling_unit_id');
        CREATE TRIGGER set_org_path BEFORE INSERT OR UPDATE ON sample.c_rows
            FOR EACH ROW EXECUTE FUNCTION kernel.set_org_path('handling_unit_id');
        CREATE TRIGGER set_org_path BEFORE INSERT OR UPDATE ON sample.r_rows
            FOR EACH ROW EXECUTE FUNCTION kernel.set_org_path('handling_unit_id', 'handling_org_path');
        SELECT kernel.apply_rls('sample.t_rows', 'transaction', 'org_path');
        SELECT kernel.apply_rls('sample.c_rows', 'config', 'org_path');
        SELECT kernel.apply_rls('sample.r_rows', 'registry', 'handling_org_path');
        SELECT kernel.apply_rls('sample.p_rows', 'party', 'party_id');
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sample TO itrms_app;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA sample TO itrms_app;`);
    for (const table of ['t_rows', 'c_rows', 'r_rows'])
        for (const c of ISOLATION_CASES)
            await owner.query(`INSERT INTO sample.${table} (label, region_id, handling_unit_id) VALUES ($1, $2, $3)`, [
                c,
                units[c].regionId,
                units[c].id
            ]);
}, 240_000);

afterAll(async () => {
    await app?.close();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

const TABLES = { transaction: 'sample.t_rows', config: 'sample.c_rows', registry: 'sample.r_rows' } as const;
const labels = async (tx: Tx, table: string) =>
    (await tx.execute<{ label: string }>(sql.raw(`SELECT label FROM ${table} ORDER BY label`))).rows.map(
        (r) => r.label
    );
const sorted = (cases: readonly string[]) => [...cases].sort();

/** The database's own message: the query builder wraps it as the cause of "Failed query: …". */
async function pgRefusal(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        const e = error as { message: string; cause?: { message?: string } };
        return e.cause?.message ?? e.message;
    }
    throw new Error('expected the database to refuse');
}

describe.each(Object.entries(TABLES))('class %s', (cls, table) => {
    const klass = cls as keyof typeof TABLES;

    it('shows the acting unit exactly its rows', async () => {
        expect(await asUnit(app, units.own, (tx) => labels(tx, table))).toEqual(sorted(VISIBLE[klass]));
    });

    it.each(ISOLATION_CASES)('lets the acting unit write a row at %s only where the class allows it', async (c) => {
        const allowed = WRITABLE[klass].includes(c);
        const insert = asUnit(app, units.own, (tx) =>
            tx.execute(
                sql.raw(
                    `INSERT INTO ${table} (label, region_id, handling_unit_id) VALUES ('new-${c}', '${units[c].regionId}', '${units[c].id}')`
                )
            )
        );
        if (allowed) await expect(insert).resolves.toBeDefined();
        // another region's unit is not even visible to the trigger that looks up the scope
        else expect(await pgRefusal(insert)).toMatch(/row-level security|not found/);

        const updated = await asUnit(app, units.own, (tx) =>
            tx.execute(sql.raw(`UPDATE ${table} SET label = label WHERE label = '${c}'`))
        );
        expect(updated.rowCount).toBe(allowed ? 1 : 0);

        // deletes: the row just written where allowed, the case's own row where not (which must survive)
        const deleted = await asUnit(app, units.own, (tx) =>
            tx.execute(sql.raw(`DELETE FROM ${table} WHERE label = '${allowed ? `new-${c}` : c}'`))
        );
        expect(deleted.rowCount).toBe(allowed ? 1 : 0);
    });

    it.each(['parent', 'sibling', 'otherRegion'] as const)(
        'cannot move one of its rows to the %s unit by changing its unit',
        async (c) => {
            const move = asUnit(app, units.own, (tx) =>
                tx.execute(sql.raw(`UPDATE ${table} SET handling_unit_id = '${units[c].id}' WHERE label = 'own'`))
            );
            expect(await pgRefusal(move)).toMatch(/row-level security|not found/);
        }
    );

    it('cannot write a row of another region for a unit of its own', async () => {
        const forged = asUnit(app, units.own, (tx) =>
            tx.execute(
                sql.raw(
                    `INSERT INTO ${table} (label, region_id, handling_unit_id) VALUES ('forged-region', '${units.otherRegion.regionId}', '${units.child.id}')`
                )
            )
        );
        expect(await pgRefusal(forged)).toMatch(/region is not its unit's|row-level security/);
    });

    it('shows nothing without a context, on a connection that has just served one', async () => {
        await asUnit(app, units.own, (tx) => labels(tx, table));
        expect(await app.scoped({}, (tx) => labels(tx, table))).toEqual([]);
    });

    it('cannot place a row in another scope by writing the scope column', async () => {
        const column = klass === 'registry' ? 'handling_org_path' : 'org_path';
        await asUnit(app, units.own, (tx) =>
            tx.execute(
                sql.raw(
                    `INSERT INTO ${table} (label, region_id, handling_unit_id, ${column}) VALUES ('forged', '${units.own.regionId}', '${units.child.id}', '${units.sibling.path}')`
                )
            )
        );
        const { rows } = await owner.query<{ path: string }>(
            `SELECT ${column} AS path FROM ${table} WHERE label = 'forged'`
        );
        expect(rows).toEqual([{ path: units.child.path }]);
    });
});

describe('class party', () => {
    it("shows an external participant only their organisation's rows", async () => {
        const [partyA, partyB] = ['0199f0a0-0000-7000-8000-0000000000a1', '0199f0a0-0000-7000-8000-0000000000b1'];
        await owner.query(
            `INSERT INTO sample.p_rows (label, region_id, party_id) VALUES ('a1', $1, $2), ('a2', $1, $2), ('b1', $1, $3), ('a-other', $4, $2)`,
            [units.own.regionId, partyA, partyB, units.otherRegion.regionId]
        );
        const asParty = (party: string) =>
            app.scoped({ ...contextFor(units.own), partyId: party }, (tx) => labels(tx, 'sample.p_rows'));
        expect(await asParty(partyA)).toEqual(['a1', 'a2']);
        expect(await asParty(partyB)).toEqual(['b1']);
        expect(await app.scoped(contextFor(units.own), (tx) => labels(tx, 'sample.p_rows'))).toEqual([]);
    });
});

describe('no way around the policies', () => {
    it('grants nothing for a bypass setting, and refuses to switch row security off', async () => {
        const rows = await app.scoped({}, async (tx) => {
            await tx.execute(
                sql`select set_config('app.bypass_rls', 'on', true), set_config('app.is_admin', 'true', true)`
            );
            return labels(tx, 'sample.t_rows');
        });
        expect(rows).toEqual([]);
        const off = app.scoped(contextFor(units.own), async (tx) => {
            await tx.execute(sql`set local row_security = off`);
            return labels(tx, 'sample.t_rows');
        });
        expect(await pgRefusal(off)).toMatch(/row-level security/);
    });

    it('reaches across scopes only through the system context, and records each use', async () => {
        const uses: string[] = [];
        const system = createSystemDatabase(pg.url('system'), { onUse: (reason) => uses.push(reason) });
        try {
            const all = await system.systemContext('test.matrix', (tx) => labels(tx, 'sample.t_rows'));
            expect(all).toEqual(expect.arrayContaining([...ISOLATION_CASES]));
            expect(uses).toEqual(['test.matrix']);
            const { rows } = await owner.query(
                "SELECT 1 FROM kernel.audit_log WHERE event_type = 'system.context_used' AND diff->>'reason' = 'test.matrix'"
            );
            expect(rows).toHaveLength(1);
        } finally {
            await system.close();
        }
    });
});

describe('the org tables under RLS', () => {
    it('show a zone its subtree and its region, not the other zone or region', async () => {
        const codes = await asUnit(app, units.own, async (tx) =>
            (await tx.select({ code: orgUnits.code }).from(orgUnits)).map((u) => u.code)
        );
        expect(codes).toContain('WOL-BODITI');
        expect(codes).toContain('SER');
        expect(codes).not.toContain('TZB');
        expect(codes).not.toContain('TZB-W1');
        expect(codes).not.toContain('TRX-W1');
    });

    it('serve the subtree under RLS from the GiST index', async () => {
        await owner.query(
            `insert into kernel.org_units (id, region_id, parent_id, kind, level_key, code, name)
             select gen_random_uuid(), $1, $2, 'woreda', 'woreda', 'TZB-X' || n, '{"am":"ወ","en":"W"}'
             from generate_series(1, 5000) n`,
            [units.sibling.regionId, units.sibling.id]
        );
        await owner.query('analyze kernel.org_units');
        const plan = await asUnit(app, units.own, async (tx) =>
            (await tx.execute<{ 'QUERY PLAN': string }>(sql`explain select id from kernel.org_units`)).rows
                .map((r) => r['QUERY PLAN'])
                .join('\n')
        );
        process.stdout.write(`EXPLAIN org_units as Wolaita Zone under RLS:\n${plan}\n`);
        expect(plan).toContain('org_units_path_gist');
    });
});

describe('every tenant table', () => {
    it("is declared, has RLS on and carries exactly its class's policies", async () => {
        const { rows: tenant } = await owner.query<{ name: string; rls: boolean }>(`
            SELECT c.oid::regclass::text AS name, c.relrowsecurity AS rls
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'drizzle', 'sample')
              AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'region_id' AND NOT a.attisdropped)
            ORDER BY 1`);
        const declared = new Map(declaredRlsTables().map((d) => [d.name, d]));
        const { rows: applied } = await owner.query<{ name: string; class: string; column_name: string }>(
            'SELECT table_name::text AS name, class, column_name FROM kernel.rls_tables'
        );
        const appliedByName = new Map(applied.map((a) => [a.name, a]));

        expect(tenant.length).toBeGreaterThan(0);
        for (const { name, rls } of tenant) {
            const declaration = declared.get(name);
            expect(declaration, `${name} has region_id but no withRls() declaration`).toBeDefined();
            expect(rls, `${name}: RLS is not enabled`).toBe(true);
            expect(appliedByName.get(name), `${name}: no kernel.apply_rls in its migration`).toMatchObject({
                class: declaration?.cls,
                column_name: declaration?.column
            });
            const { rows: policies } = await owner.query<{ polname: string; roles: string[] }>(
                `SELECT polname, (SELECT array_agg(rolname::text) FROM pg_roles WHERE oid = ANY (polroles)) AS roles
                 FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
                [name]
            );
            expect(
                policies.map((p) => p.polname),
                `${name}: policies`
            ).toEqual(POLICIES[declaration?.cls ?? 'party']);
            expect(
                policies.every((p) => p.roles.join() === 'itrms_app'),
                `${name}: policies TO itrms_app only`
            ).toBe(true);
        }
        for (const name of declared.keys())
            expect(
                tenant.map((t) => t.name),
                `${name} is declared but not in the database`
            ).toContain(name);
    });

    it("carries its class's policy expressions exactly (no hand-edited policy)", async () => {
        const SAMPLE: Record<string, [table: string, column: string]> = {
            transaction: ['t_rows', 'org_path'],
            config: ['c_rows', 'org_path'],
            registry: ['r_rows', 'handling_org_path'],
            party: ['p_rows', 'party_id']
        };
        const policiesOf = async (schema: string, table: string) =>
            (
                await owner.query<{ name: string; qual: string | null; check: string | null }>(
                    `SELECT policyname AS name, qual, with_check AS check FROM pg_policies
                     WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname`,
                    [schema, table]
                )
            ).rows;
        for (const { name, cls, column } of declaredRlsTables()) {
            const [schema = '', table = ''] = name.split('.');
            const [sampleTable, sampleColumn] = SAMPLE[cls] ?? ['', ''];
            const expected = (await policiesOf('sample', sampleTable)).map((p) => ({
                name: p.name,
                qual: p.qual?.replaceAll(new RegExp(`\\b${sampleColumn}\\b`, 'g'), column) ?? null,
                check: p.check?.replaceAll(new RegExp(`\\b${sampleColumn}\\b`, 'g'), column) ?? null
            }));
            expect(await policiesOf(schema, table), `${name}: policy expressions`).toEqual(expected);
        }
    });

    it('is all the API role can reach, and views run as the reader', async () => {
        // relations the API may read that hold no tenant rows: reviewed one by one
        const NOT_TENANT = ['kernel.rls_tables'];
        const { rows } = await owner.query<{ name: string; kind: string; invoker: boolean }>(`
            SELECT c.oid::regclass::text AS name, c.relkind::text AS kind,
                   coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'sample') AND n.nspname NOT LIKE 'pg\\_%'
              AND has_table_privilege('itrms_app', c.oid, 'SELECT')
            ORDER BY 1`);
        const declared = new Set(declaredRlsTables().map((d) => d.name));
        for (const { name, kind, invoker } of rows) {
            expect(declared.has(name) || NOT_TENANT.includes(name), `${name}: readable by the API, not declared`).toBe(
                true
            );
            if (kind === 'v') expect(invoker, `${name}: a view must be security_invoker`).toBe(true);
            expect(kind, `${name}: materialised views bypass RLS`).not.toBe('m');
        }
    });

    it('lets the API call no SECURITY DEFINER function but the reviewed ones', async () => {
        const { rows } = await owner.query<{ name: string }>(`
            SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND has_function_privilege('itrms_app', p.oid, 'EXECUTE')
            ORDER BY 1`);
        expect(rows.map((r) => r.name)).toEqual([
            // which of the form versions the caller reads a second person approved (task 0.19b)
            'forms.approved_versions(uuid[])',
            // the caller's region's first data key, once (task 0.14)
            'kernel.ensure_region_data_key(uuid,text,bytea)',
            // the caller's own notifications only (by app.user_id), and marking them read (task 0.20a)
            'kernel.my_notifications(integer,timestamp with time zone)',
            'kernel.principal_units(text)',
            'kernel.read_my_notifications(uuid[])',
            'kernel.record_context_free_event(text,jsonb,uuid,text,text)',
            // ids, codes and names of units of the caller's region only (task 0.14)
            'kernel.region_units(uuid[])',
            'kernel.resolve_principal(text,uuid)',
            // the caller's own preferences only (by app.user_id), task 0.13
            'kernel.set_my_preferences(jsonb)',
            // the registers' searches, limited to the caller's region; ids only (task 0.14)
            'parties.search_organisations(text,integer)',
            'parties.search_persons(text,bytea,bytea,integer)',
            // the step a transition leads to, in a unit above the caller's scope, for a case they see (task 0.19b)
            'workflow.open_task(uuid,uuid,text,uuid,text,uuid,timestamp with time zone)',
            // who holds a role in a unit of the caller's chain: user ids only (task 0.19b)
            'workflow.role_holders(uuid,text)'
        ]);
    });
});

describe('a sensitive event before a unit is known', () => {
    it('is recorded without a scope, and only an access or auth event can be', async () => {
        await app.recordSensitiveEvent(
            { requestId: 'req-denied', userId: '0199f0a0-0000-7000-8000-00000000dead', ip: '10.1.2.3' },
            { type: 'access.denied', data: { route: 'GET /api/v1/org-units/x' } }
        );
        const { rows } = await owner.query(
            "SELECT region_id, org_path, actor_id, diff FROM kernel.audit_log WHERE request_id = 'req-denied'"
        );
        expect(rows).toEqual([
            {
                region_id: null,
                org_path: null,
                actor_id: '0199f0a0-0000-7000-8000-00000000dead',
                diff: { route: 'GET /api/v1/org-units/x' }
            }
        ]);
        expect(await pgRefusal(app.recordSensitiveEvent({}, { type: 'case.deleted' }))).toMatch(
            /not an access or auth event/
        );
    });
});

describe('a move under RLS', () => {
    it('carries the scope of the rows below the unit, and leaves the audit log as it was', async () => {
        const moving = await unitAt('SER', 'TZB-W1');
        const zone = await unitAt('SER', 'WOL');
        const auditBefore = await owner.query<{ org_path: string }>(
            'SELECT org_path::text FROM kernel.audit_log ORDER BY at, id'
        );
        // the region's own unit may move a woreda from one zone to another
        const moved = await asUnit(app, units.parent, (tx) => moveUnit(tx, moving.id, moving.rowVersion, zone.id));
        expect(moved.path.startsWith(`${zone.path}.`)).toBe(true);

        const { rows: rowsBelow } = await owner.query<{ path: string }>(
            "SELECT org_path::text AS path FROM sample.t_rows WHERE label = 'otherZone'"
        );
        expect(rowsBelow).toEqual([{ path: moved.path }]);
        const { rows: teams } = await owner.query<{ path: string }>(
            'SELECT DISTINCT org_path::text AS path FROM kernel.org_departments WHERE org_unit_id = $1',
            [moving.id]
        );
        expect(teams).toEqual([{ path: moved.path }]);
        const auditAfter = await owner.query<{ org_path: string }>(
            'SELECT org_path::text FROM kernel.audit_log ORDER BY at, id'
        );
        expect(auditAfter.rows.slice(0, auditBefore.rows.length)).toEqual(auditBefore.rows);
    });
});
