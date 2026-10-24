/**
 * The API over HTTP on a test database, for the integration suites: the Wolaita seeds, Test Zone B and Test Region X, the
 * demo users plus a suite's own, a realm key that signs tokens, and `call(method, url, as, body)` with an
 * Idempotency-Key on every POST. Names are generated (never a real person's).
 */
import { randomBytes, randomUUID } from 'node:crypto';
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
import { findUnitByCode, importOrg, orgUnits, parseOrgYaml, type OrgUnit } from '@itrms/kernel/org';
import { importUsers, userImportSchema } from '@itrms/kernel/seed';
import { and, eq, isNull } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client } from 'pg';
import { parse as parseYaml } from 'yaml';

import { SLICES } from '../../../src/slices';
import type { TestPostgres } from './postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', '..', '..', 'seed');
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'org');
const ISSUER = 'http://keycloak.test/realms/itrms';
const AUDIENCE = 'itrms-api';

export interface TestUser {
    username: string;
    sub: string;
    region: 'SER' | 'TRX';
    home: string;
    roles: [unit: string, role: string][];
}

export interface As {
    sub: string;
    unit: OrgUnit;
}

export interface TestApi {
    owner: Client;
    installer: Database;
    http: NestFastifyApplication;
    unit(region: string, code: string): Promise<OrgUnit>;
    /** a user's id in ITRMS (`created_by` of what they write) */
    userId(sub: string): Promise<string>;
    call(
        method: 'GET' | 'POST' | 'PATCH',
        url: string,
        as: As,
        body?: object,
        headers?: Record<string, string>
    ): ReturnType<NestFastifyApplication['inject']>;
    close(): Promise<void>;
}

export async function startApi(pg: TestPostgres, users: TestUser[] = []): Promise<TestApi> {
    const installer = createDatabase(pg.url('owner'));
    const owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    for (const file of [
        join(SEEDS, 'org', 'south-ethiopia.wolaita.yaml'),
        join(FIXTURES, 'test-zone-b.yaml'),
        join(FIXTURES, 'region-without-zones.yaml')
    ])
        await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(file, 'utf8'))));
    const demo = userImportSchema.parse(parseYaml(readFileSync(join(SEEDS, 'users', 'wolaita.demo.yaml'), 'utf8')));
    await installer.scoped({}, (tx) => importUsers(tx, demo));
    // Test Region X's district offices have no roles in their fixture: the suites may give them a records officer
    await owner.query(`insert into kernel.unit_type_roles (id, region_id, unit_type_id, role_key, delegable)
        select gen_random_uuid(), t.region_id, t.id, 'records_officer', false from kernel.unit_types t
         where t.key = 'district_office'`);
    for (const region of ['SER', 'TRX'] as const) {
        const mine = users.filter((u) => u.region === region);
        if (mine.length)
            await installer.scoped({}, (tx) =>
                importUsers(tx, {
                    region,
                    users: mine.map((u) => ({
                        username: u.username,
                        displayName: `${u.username} (test)`,
                        keycloakSub: u.sub,
                        home: u.home,
                        roles: u.roles.map(([unit, role]) => ({ unit, role }))
                    }))
                })
            );
    }

    const realm = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
    const sign = (sub: string) =>
        new SignJWT({ sub, iss: ISSUER, aud: AUDIENCE, typ: 'Bearer', azp: 'itrms-web' })
            .setProtectedHeader({ alg: 'RS256', kid: 'realm-key' })
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(realm.privateKey);
    const keys = {
        AUDIT_HMAC_KEY: randomBytes(32).toString('hex'),
        FIELD_KEYS: `k1:${randomBytes(32).toString('base64')}`,
        BLIND_INDEX_KEY: randomBytes(32).toString('hex')
    };
    const config = loadConfig('http', { DATABASE_URL: pg.url('app'), ...keys });
    const logger = createLogger(
        config,
        process.env.INT_LOG ? process.stderr : new Writable({ write: (_c, _e, done) => done() })
    );
    const app = createDatabase(config.DATABASE_URL, { auditKey: keys.AUDIT_HMAC_KEY });
    const installed = loadSlices(SLICES);
    @Module({})
    class Root {
        static forRoot(): DynamicModule {
            return {
                module: Root,
                imports: [
                    KernelModule.forRoot(config, logger, {
                        database: app,
                        identity: { issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) },
                        roles: rolePermissions(installed.manifests),
                        shell: { manifests: installed.manifests, messages: installed.messages }
                    }),
                    ...installed.modules
                ]
            };
        }
    }
    const http = await createHttpApp(Root.forRoot(), config, logger);
    await http.init();
    await http.getHttpAdapter().getInstance().ready();

    return {
        owner,
        installer,
        http,
        unit: (region, code) =>
            installer.scoped({}, async (tx) => {
                const [root] = await tx
                    .select()
                    .from(orgUnits)
                    .where(and(isNull(orgUnits.parentId), eq(orgUnits.code, region)));
                const found = root && (await findUnitByCode(tx, root.id, code));
                if (!found) throw new Error(`no unit ${code}`);
                return found;
            }),
        userId: async (sub) => {
            const { rows } = await owner.query<{ id: string }>('select id from kernel.users where keycloak_sub = $1', [
                sub
            ]);
            if (!rows[0]) throw new Error(`no user ${sub}`);
            return rows[0].id;
        },
        call: async (method, url, as, body, headers = {}) =>
            http
                .getHttpAdapter()
                .getInstance()
                .inject({
                    method,
                    url,
                    headers: {
                        authorization: `Bearer ${await sign(as.sub)}`,
                        'x-org-unit': as.unit.id,
                        'accept-language': 'en',
                        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
                        ...headers
                    },
                    payload: body
                }),
        close: async () => {
            // the app's database closes with the app
            await http.close();
            await installer.close();
            await owner.end();
        }
    };
}
