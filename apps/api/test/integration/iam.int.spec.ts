/**
 * Identity and permissions over HTTP (task 0.10), on a real PostgreSQL 16 with the Wolaita org and demo-user seeds. Tokens
 * are signed by a key of the test's own (a local JWKS stands in for Keycloak's): the API checks signature, issuer,
 * audience and expiry, then reads the caller's roles in the unit of `X-Org-Unit` from role_assignments.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Module, type DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHttpApp, createLogger, KernelModule, loadSlices } from '@itrms/kernel/api';
import { loadConfig } from '@itrms/kernel/config';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { rolePermissions } from '@itrms/kernel/iam';
import { importUsers, userImportSchema } from '@itrms/kernel/seed';
import {
    clearServiceOverride,
    findUnitByCode,
    importOrg,
    orgUnits,
    parseOrgYaml,
    setServiceOverride,
    type OrgUnit
} from '@itrms/kernel/org';
import { and, eq, isNull } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { SLICES } from '../../src/slices';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', '..', 'seed');
const ISSUER = 'http://keycloak.test/realms/itrms';
const AUDIENCE = 'itrms-api';
const SUB = {
    dual: '0199f0a0-d000-7000-8000-000000000401',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    boditiOfficer: '0199f0a0-d000-7000-8000-000000000305',
    multi: '0199f0a0-d000-7000-8000-000000000402',
    bureauAdmin: '0199f0a0-d000-7000-8000-000000000001'
};

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let http: NestFastifyApplication;
let sign: (claims: JWTPayload, options?: { key?: 'other'; expiresIn?: string; issuedAt?: number }) => Promise<string>;

async function unitAt(code: string): Promise<OrgUnit> {
    return installer.scoped({}, async (tx) => {
        const [root] = await tx
            .select()
            .from(orgUnits)
            .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, 'SER')));
        const found = root && (await findUnitByCode(tx, root.id, code));
        if (!found) throw new Error(`no unit ${code}`);
        return found;
    });
}

beforeAll(async () => {
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    await installer.scoped({}, (tx) =>
        importOrg(tx, parseOrgYaml(readFileSync(join(SEEDS, 'org', 'south-ethiopia.wolaita.yaml'), 'utf8')))
    );
    const users = userImportSchema.parse(parseYaml(readFileSync(join(SEEDS, 'users', 'wolaita.demo.yaml'), 'utf8')));
    await installer.scoped({}, (tx) => importUsers(tx, users));

    const realm = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
    sign = (claims, options = {}) =>
        new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'realm-key' })
            .setIssuedAt(options.issuedAt)
            .setExpirationTime(options.expiresIn ?? '5m')
            .sign(options.key === 'other' ? other.privateKey : realm.privateKey);

    const config = loadConfig('http', { DATABASE_URL: pg.url('app') });
    const logger = createLogger(config, new Writable({ write: (_c, _e, done) => done() }));
    const database = createDatabase(config.DATABASE_URL);
    // the installation's real slices: their roles, menus and catalogues
    const installed = loadSlices(SLICES);
    @Module({})
    class Root {
        static forRoot(): DynamicModule {
            return {
                module: Root,
                imports: [
                    KernelModule.forRoot(config, logger, {
                        database,
                        identity: { issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) },
                        roles: rolePermissions(installed.manifests),
                        shell: { manifests: installed.manifests, messages: installed.messages }
                    })
                ]
            };
        }
    }
    http = await createHttpApp(Root.forRoot(), config, logger);
    await http.init();
    await http.getHttpAdapter().getInstance().ready();
}, 240_000);

afterAll(async () => {
    await http?.close();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

/** A Keycloak access token issued to the BFF. */
const access = { iss: ISSUER, aud: AUDIENCE, typ: 'Bearer', azp: 'itrms-web' };
/** `authAge`: how long before the token was issued the person entered their factors. */
const token = (sub: string, authAge = 0) =>
    sign({ sub, ...access, auth_time: Math.floor(Date.now() / 1000) - authAge });
async function call(
    method: 'GET' | 'POST',
    url: string,
    as?: { token: string; unit?: string },
    body?: object,
    headers = {}
) {
    return http
        .getHttpAdapter()
        .getInstance()
        .inject({
            method,
            url,
            payload: body,
            headers: {
                ...(as ? { authorization: `Bearer ${as.token}` } : {}),
                ...(as?.unit ? { 'x-org-unit': as.unit } : {}),
                // every POST carries an Idempotency-Key, as the web client's do
                ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
                ...headers
            }
        });
}
/** The refusals recorded since `mark()`: counted, not timed (the host's and the database's clocks differ). */
const denials = async () =>
    (
        await owner.query<{ actor_id: string | null; region_id: string | null; diff: Record<string, string> }>(
            "SELECT actor_id, region_id, diff FROM kernel.audit_log WHERE event_type = 'access.denied' ORDER BY at, id"
        )
    ).rows;
const mark = async () => (await denials()).length;
const deniedEvents = async (since: number) => (await denials()).slice(since);

describe('the token', () => {
    it("is required, and must be the realm's, for the API, and current", async () => {
        const url = '/api/v1/me/workspace';
        expect((await call('GET', url)).statusCode).toBe(401);
        const bad = [
            await sign({ sub: SUB.dual, ...access, iss: 'http://elsewhere/realms/itrms' }),
            await sign({ sub: SUB.dual, ...access, aud: 'another-client' }),
            await sign({ sub: SUB.dual, ...access }, { key: 'other' }),
            await sign({ sub: SUB.dual, ...access }, { expiresIn: '-1m' }),
            // an ID token, or a token issued to another client of the realm
            await sign({ sub: SUB.dual, ...access, typ: 'ID' }),
            await sign({ sub: SUB.dual, ...access, azp: 'some-other-client' }),
            'not.a.token'
        ];
        for (const t of bad) expect((await call('GET', url, { token: t })).statusCode).toBe(401);
        expect((await call('GET', url, { token: await token(SUB.dual) })).statusCode).toBe(200);
    });

    it('never decides permissions: roles in the token are ignored', async () => {
        const forged = await sign({
            sub: SUB.damotRecords,
            ...access,
            realm_access: { roles: ['bureau_admin'] },
            roles: ['bureau_admin']
        });
        const res = await call('GET', '/api/v1/me/workspace', { token: forged });
        expect(res.json()).toMatchObject({ roles: ['records_officer'] });
    });
});

describe('the menu (task 0.10b, ADR-0028)', () => {
    interface Workspace {
        activeUnit: { code: string };
        menu: { key: string; label: { am: string; en: string }; items: { key: string; route: string }[] }[];
    }
    const itemsOf = (w: Workspace) => w.menu.flatMap((g) => g.items.map((i) => i.key));

    it("shows no licensing at Damot Gale (no DVC services), and a Boditi competency officer's licensing", async () => {
        const damot = await unitAt('WOL-DAMOT-GALE');
        const atDamot = (
            await call('GET', '/api/v1/me/workspace', { token: await token(SUB.damotRecords), unit: damot.id })
        ).json<Workspace>();
        expect(itemsOf(atDamot)).toEqual(['kernel.home']);

        const boditi = await unitAt('WOL-BODITI');
        const officer = (
            await call('GET', '/api/v1/me/workspace', { token: await token(SUB.boditiOfficer), unit: boditi.id })
        ).json<Workspace>();
        expect(officer.menu.map((g) => g.key)).toEqual(['home', 'work-process:1']);
        expect(officer.menu[1]?.label).toMatchObject({ en: 'Driver and vehicle competency' });
        // applications and exams (Boditi has examiners); print batches need licence:print, which officers lack
        expect(itemsOf(officer)).toEqual(['kernel.home', 'competency.applications', 'competency.exams']);
    });

    it('hides licensing from a competency officer whose unit stops offering the licensing services', async () => {
        const boditi = await unitAt('WOL-BODITI');
        const licensing = ['DVC-03', 'DVC-04', 'DVC-08', 'DVC-10', 'DVC-11'];
        const officerMenu = async () =>
            itemsOf(
                (
                    await call('GET', '/api/v1/me/workspace', {
                        token: await token(SUB.boditiOfficer),
                        unit: boditi.id
                    })
                ).json<Workspace>()
            );
        await installer.scoped({}, async (tx) => {
            for (const code of licensing) await setServiceOverride(tx, boditi.id, code, false, 'test: no licensing');
        });
        try {
            // the same person and role: only the unit's services changed
            expect(await officerMenu()).toEqual(['kernel.home']);
        } finally {
            await installer.scoped({}, async (tx) => {
                for (const code of licensing) await clearServiceOverride(tx, boditi.id, code);
            });
        }
        expect(await officerMenu()).toContain('competency.applications');
    });

    it('follows the unit the person acts for', async () => {
        const zone = await unitAt('WOL');
        const damot = await unitAt('WOL-DAMOT-GALE');
        const t = await token(SUB.multi);
        const atZone = (await call('GET', '/api/v1/me/workspace', { token: t, unit: zone.id })).json<Workspace>();
        const atDamot = (await call('GET', '/api/v1/me/workspace', { token: t, unit: damot.id })).json<Workspace>();
        expect(itemsOf(atZone)).toContain('competency.applications');
        expect(itemsOf(atDamot)).toEqual(['kernel.home']);
    });
});

describe('a person in two units', () => {
    it('gets exactly the roles and permissions of the unit they act for', async () => {
        const boditi = await unitAt('WOL-BODITI');
        const zone = await unitAt('WOL');
        const t = await token(SUB.dual);
        const atBoditi = (await call('GET', '/api/v1/me/workspace', { token: t, unit: boditi.id })).json<{
            roles: string[];
            permissions: string[];
            activeUnit: { code: string; services: string[]; capabilities: string[] };
            units: { code: string; roles: string[] }[];
        }>();
        expect(atBoditi.roles).toEqual(['cashier']);
        expect(atBoditi.activeUnit).toMatchObject({ code: 'WOL-BODITI' });
        expect(atBoditi.activeUnit.services).toContain('DVC-03');
        expect(atBoditi.activeUnit.capabilities).toContain('collects_cash');
        expect(atBoditi.units).toEqual([
            expect.objectContaining({ code: 'WOL', roles: ['records_officer'] }),
            expect.objectContaining({ code: 'WOL-BODITI', roles: ['cashier'] })
        ]);

        const atZone = (await call('GET', '/api/v1/me/workspace', { token: t, unit: zone.id })).json<{
            roles: string[];
            activeUnit: { code: string };
        }>();
        expect(atZone.roles).toEqual(['records_officer']);
        expect(atZone.activeUnit.code).toBe('WOL');
        // the same permissions here, from different roles; neither grants administration
        for (const perms of [atBoditi.permissions]) expect(perms).toEqual(['org-unit:read', 'service-config:read']);
    });

    it('is refused a unit they hold no role in, and the refusal is on record', async () => {
        const since = await mark();
        const damotGale = await unitAt('WOL-DAMOT-GALE');
        const res = await call('GET', '/api/v1/me/workspace', { token: await token(SUB.dual), unit: damotGale.id });
        expect(res.statusCode).toBe(403);
        expect(await deniedEvents(since)).toEqual([
            expect.objectContaining({
                region_id: null,
                diff: expect.objectContaining({ reason: 'no_role_in_unit', subject: SUB.dual }) as unknown
            })
        ]);
        expect(
            (await call('GET', '/api/v1/me/workspace', { token: await token(SUB.dual), unit: 'not-a-uuid' })).statusCode
        ).toBe(400);
    });
});

describe('the guards and the scope', () => {
    it('answer 403 without the permission (on record) and 404 outside the active scope', async () => {
        const since = await mark();
        const zone = await unitAt('WOL');
        const boditi = await unitAt('WOL-BODITI');
        const damotRecords = await token(SUB.damotRecords);
        const created = await call(
            'POST',
            '/api/v1/org-units',
            { token: damotRecords },
            { parentId: zone.id, kind: 'town_admin', levelKey: 'town', code: 'WOL-X', name: { am: 'ሀ', en: 'X' } }
        );
        expect(created.statusCode).toBe(403);
        const [event] = await deniedEvents(since);
        expect(event).toMatchObject({ diff: { reason: 'missing_permission', permission: 'org-unit:create' } });
        expect(event?.region_id).toBe(zone.regionId);

        expect((await call('GET', `/api/v1/org-units/${boditi.id}`, { token: damotRecords })).statusCode).toBe(404);
        expect(
            (await call('GET', `/api/v1/org-units/${boditi.id}`, { token: await token(SUB.dual), unit: boditi.id }))
                .statusCode
        ).toBe(200);
    });
});

describe('granting and revoking', () => {
    it('grants only delegable roles of the unit type, never to oneself, never backdated', async () => {
        const damotGale = await unitAt('WOL-DAMOT-GALE');
        const zoneAdmin = await token(SUB.zoneAdmin);
        const { rows } = await owner.query<{ id: string }>(
            "SELECT id FROM kernel.users WHERE username = 'demo.damot.head'"
        );
        const userId = rows[0]?.id ?? '';
        const grant = (roleKey: string) =>
            call(
                'POST',
                '/api/v1/role-assignments',
                { token: zoneAdmin },
                { userId, unitId: damotGale.id, roleKey, reason: 'cover for leave' }
            );

        const notInType = await grant('competency.officer');
        expect(notInType.statusCode).toBe(422);
        expect(notInType.json()).toMatchObject({ errors: [{ code: 'role_not_in_unit_type' }] });
        // unit_admin is not delegable: only a bureau admin grants it
        expect((await grant('unit_admin')).statusCode).toBe(403);
        const { rows: self } = await owner.query<{ id: string }>(
            "SELECT id FROM kernel.users WHERE username = 'demo.zone.admin'"
        );
        const selfGrant = await call(
            'POST',
            '/api/v1/role-assignments',
            { token: zoneAdmin },
            { userId: self[0]?.id, unitId: damotGale.id, roleKey: 'records_officer', reason: 'myself' }
        );
        expect(selfGrant.statusCode).toBe(403);
        const backdated = await call(
            'POST',
            '/api/v1/role-assignments',
            { token: zoneAdmin },
            {
                userId,
                unitId: damotGale.id,
                roleKey: 'records_officer',
                reason: 'late',
                validFrom: '2020-01-01T00:00:00+03:00'
            }
        );
        expect(backdated.json()).toMatchObject({ status: 422, errors: [{ code: 'backdated' }] });
        const ok = await grant('road_safety.officer');
        expect(ok.statusCode).toBe(201);
        expect((await grant('road_safety.officer')).statusCode).toBe(409);
    });

    it('needs a second factor entered in the last 5 minutes (step-up, RFC 9470)', async () => {
        const damotGale = await unitAt('WOL-DAMOT-GALE');
        const { rows } = await owner.query<{ id: string }>(
            "SELECT id FROM kernel.users WHERE username = 'demo.damot.head'"
        );
        const body = { userId: rows[0]?.id, unitId: damotGale.id, roleKey: 'viewer', reason: 'reads the dashboards' };
        const since = await mark();
        const now = Math.floor(Date.now() / 1000);
        const stale = [
            await token(SUB.zoneAdmin, 301),
            await sign({ sub: SUB.zoneAdmin, ...access }),
            // fresh when issued, but the token itself is 4 minutes old: 7 minutes since the factors
            await sign({ sub: SUB.zoneAdmin, ...access, auth_time: now - 420 }, { issuedAt: now - 240 })
        ];
        for (const old of stale) {
            const res = await call('POST', '/api/v1/role-assignments', { token: old }, body);
            expect(res.statusCode).toBe(401);
            expect(res.json()).toMatchObject({ code: 'step_up_required' });
            expect(res.headers['www-authenticate']).toBe(
                'Bearer error="insufficient_user_authentication", max_age=300'
            );
        }
        // asking for a fresh sign-in is not a denial
        expect(await deniedEvents(since)).toEqual([]);
        const fresh = await call('POST', '/api/v1/role-assignments', { token: await token(SUB.zoneAdmin, 299) }, body);
        expect(fresh.statusCode).toBe(201);
    });

    it('takes a revoked assignment away on the next request', async () => {
        const boditi = await unitAt('WOL-BODITI');
        const zoneAdmin = await token(SUB.zoneAdmin);
        const dual = await token(SUB.dual);
        expect((await call('GET', '/api/v1/me/workspace', { token: dual, unit: boditi.id })).statusCode).toBe(200);

        const list = await call('GET', `/api/v1/org-units/${boditi.id}/role-assignments`, { token: zoneAdmin });
        const assignment = list
            .json<{ id: string; username: string; roleKey: string; version: number }[]>()
            .find((a) => a.username === 'demo.dual' && a.roleKey === 'cashier');
        expect(assignment).toBeDefined();
        const revoked = await call(
            'POST',
            `/api/v1/role-assignments/${assignment?.id}/revocations`,
            { token: zoneAdmin },
            undefined,
            {
                'if-match': String(assignment?.version)
            }
        );
        expect(revoked.statusCode).toBe(201);

        expect((await call('GET', '/api/v1/me/workspace', { token: dual, unit: boditi.id })).statusCode).toBe(403);
        // still records officer at the zone
        expect((await call('GET', '/api/v1/me/workspace', { token: dual })).json()).toMatchObject({
            roles: ['records_officer']
        });
    });

    it('never lets an administrator end their own assignment', async () => {
        const zone = await unitAt('WOL');
        const zoneAdmin = await token(SUB.zoneAdmin);
        const own = (await call('GET', `/api/v1/org-units/${zone.id}/role-assignments`, { token: zoneAdmin }))
            .json<{ id: string; username: string; version: number }[]>()
            .find((a) => a.username === 'demo.zone.admin');
        const res = await call(
            'POST',
            `/api/v1/role-assignments/${own?.id}/revocations`,
            { token: zoneAdmin },
            undefined,
            {
                'if-match': String(own?.version)
            }
        );
        expect(res.statusCode).toBe(403);
    });
});
