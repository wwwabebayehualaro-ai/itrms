/**
 * The register of people and organisations (task 0.14), over HTTP on a real PostgreSQL 16 with the Wolaita seeds, Test
 * Zone B and Test Region X: a person registered in Damot Gale is found from Boditi and from Test Zone B and is invisible
 * in another region; duplicates are flagged before saving; every change is audited with the personal fields masked; a
 * viewer never sees a FIN or phone; reveal needs pii:reveal, a reason and a recent second factor; a merge needs a second
 * person. Names and numbers are generated (never a real person's).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { asUnit } from '@itrms/kernel/testing';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { SLICES } from '../../src/slices';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', '..', 'seed');
const FIXTURES = join(HERE, '..', 'fixtures', 'org');
const ISSUER = 'http://keycloak.test/realms/itrms';
const AUDIENCE = 'itrms-api';
const SUB = {
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotHead: '0199f0a0-d000-7000-8000-000000000201',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    viewer: '0199f0a0-d000-7000-8000-00000000f001'
};

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let http: NestFastifyApplication;
let sign: (sub: string, authAge?: number) => Promise<string>;
const units = {} as Record<'damot' | 'boditi' | 'zone' | 'tzb' | 'trx', OrgUnit>;

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
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    for (const file of [
        join(SEEDS, 'org', 'south-ethiopia.wolaita.yaml'),
        join(FIXTURES, 'test-zone-b.yaml'),
        join(FIXTURES, 'region-without-zones.yaml')
    ])
        await installer.scoped({}, (tx) => importOrg(tx, parseOrgYaml(readFileSync(file, 'utf8'))));
    const demo = userImportSchema.parse(parseYaml(readFileSync(join(SEEDS, 'users', 'wolaita.demo.yaml'), 'utf8')));
    await installer.scoped({}, (tx) => importUsers(tx, demo));
    await installer.scoped({}, (tx) =>
        importUsers(tx, {
            region: 'SER',
            users: [
                {
                    username: 'test.zone.viewer',
                    displayName: 'Zone Viewer (test)',
                    keycloakSub: SUB.viewer,
                    home: 'WOL',
                    roles: [{ unit: 'WOL', role: 'viewer' }]
                }
            ]
        })
    );
    units.damot = await unitAt('SER', 'WOL-DAMOT-GALE');
    units.boditi = await unitAt('SER', 'WOL-BODITI');
    units.zone = await unitAt('SER', 'WOL');
    units.tzb = await unitAt('SER', 'TZB-W1');
    units.trx = await unitAt('TRX', 'TRX-W1');

    const realm = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
    // authAge: how long before the token the person entered their second factor
    sign = (sub, authAge = 0) =>
        new SignJWT({
            sub,
            iss: ISSUER,
            aud: AUDIENCE,
            typ: 'Bearer',
            azp: 'itrms-web',
            auth_time: Math.floor(Date.now() / 1000) - authAge
        })
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
    app = createDatabase(config.DATABASE_URL, { auditKey: keys.AUDIT_HMAC_KEY });
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
                        shell: {
                            manifests: installed.manifests,
                            messages: installed.messages,
                            settings: installed.settings
                        }
                    }),
                    ...installed.modules
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

type Method = 'GET' | 'POST' | 'PATCH';
async function call(
    method: Method,
    url: string,
    as: { sub: string; unit: OrgUnit; authAge?: number },
    body?: object,
    headers: Record<string, string> = {}
) {
    return http
        .getHttpAdapter()
        .getInstance()
        .inject({
            method,
            url,
            headers: {
                authorization: `Bearer ${await sign(as.sub, as.authAge)}`,
                'x-org-unit': as.unit.id,
                'accept-language': 'en',
                ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
                ...headers
            },
            payload: body
        });
}

const damot = () => ({ sub: SUB.damotRecords, unit: units.damot });
const boditi = () => ({ sub: SUB.boditiRecords, unit: units.boditi });

interface PersonOut {
    id: string;
    version: number;
    nameAm: { given: string; father: string };
    sensitive: Record<string, boolean>;
    status: string;
    handlingUnit: { code: string };
    [key: string]: unknown;
}
const ids = (res: { json: () => { items: { id: string }[] } }) => res.json().items.map((p) => p.id);

/** A fictitious person: a generated name and generated numbers. */
function generated(n: number) {
    return {
        nameAm: { given: 'ሐና', father: `ተስፋ${['ዬ', 'ሁን', 'ማርያም'][n % 3]}`, grandfather: 'ገብሬ' },
        nameEn: { given: 'Hana', father: `Tesfa${['ye', 'hun', 'mariam'][n % 3]}`, grandfather: 'Gebre' },
        sex: 'female',
        address: { unitId: units.damot.id, kebele: `0${n % 9}` },
        sensitive: {
            birthDate: `199${n % 10}-0${(n % 9) + 1}-1${n % 10}`,
            phone: `0911 ${String(100000 + n).slice(-6)}`,
            fin: String(400000000000 + n)
        }
    };
}

describe('a person registered in Damot Gale', () => {
    let person: PersonOut;
    let input: ReturnType<typeof generated>;

    beforeAll(async () => {
        input = generated(1);
        const res = await call('POST', '/api/v1/persons', damot(), input);
        expect(res.statusCode, res.body).toBe(201);
        person = res.json<PersonOut>();
    });

    it('answers with its names and whether each sensitive field is on record, never their values', () => {
        expect(person).toMatchObject({
            nameAm: input.nameAm,
            nameEn: input.nameEn,
            birthYear: 1991,
            handlingUnit: { code: 'WOL-DAMOT-GALE' },
            sensitive: { birthDate: true, phone: true, fin: true },
            status: 'active'
        });
        expect(JSON.stringify(person)).not.toContain(input.sensitive.fin);
        expect(JSON.stringify(person)).not.toContain('911100001');
    });

    it('is found from Boditi by its names in either script, homophones and case folded', async () => {
        for (const q of ['ሐና ተስፋሁን', 'ሀና', 'hana tesfahun', 'TESFAHUN']) {
            const res = await call('GET', `/api/v1/persons?q=${encodeURIComponent(q)}`, boditi());
            expect(res.statusCode).toBe(200);
            expect(ids(res), q).toContain(person.id);
        }
        expect((await call('GET', `/api/v1/persons/${person.id}`, boditi())).json()).toMatchObject({
            id: person.id,
            handlingUnit: { code: 'WOL-DAMOT-GALE', name: { en: 'Damot Gale' } }
        });
    });

    it('is found from Test Zone B (same region), and is not visible in another region', async () => {
        const search = (unit: OrgUnit) =>
            asUnit(app, unit, async (tx) => {
                const found = await tx.execute<{ person_id: string }>(
                    sql`select person_id from parties.search_persons(${'hana'}, null, null, 20)`
                );
                const direct = await tx.execute<{ id: string }>(sql`select id from parties.persons`);
                return { found: found.rows.map((r) => r.person_id), direct: direct.rows.map((r) => r.id) };
            });
        const tzb = await search(units.tzb);
        expect(tzb.found).toContain(person.id);
        expect(tzb.direct).toContain(person.id);
        const trx = await search(units.trx);
        expect(trx.found).toEqual([]);
        expect(trx.direct).toEqual([]);
        // nor its sensitive row, nor the region's data key
        const other = await asUnit(app, units.trx, async (tx) => ({
            sensitive: (await tx.execute(sql`select 1 from parties.person_sensitive`)).rows.length,
            keys: (await tx.execute(sql`select 1 from kernel.region_data_keys`)).rows.length
        }));
        expect(other).toEqual({ sensitive: 0, keys: 0 });
    });

    it('is found by its FIN or phone (sent in the body, never the URL) through the blind index', async () => {
        const byFin = await call('POST', '/api/v1/persons/lookup', boditi(), { fin: input.sensitive.fin });
        expect(byFin.statusCode).toBe(200);
        expect(ids(byFin)).toEqual([person.id]);
        const byPhone = await call('POST', '/api/v1/persons/lookup', boditi(), { phone: '+251 911 100001' });
        expect(ids(byPhone)).toEqual([person.id]);
        expect(ids(await call('POST', '/api/v1/persons/lookup', boditi(), { fin: '999999999999' }))).toEqual([]);

        // each lookup is on record (who, by which kind of value), never the value; none leaves an idempotency record
        const events = await owner.query<{ diff: unknown }>(
            "select diff from kernel.audit_log where event_type = 'person.looked_up' order by at"
        );
        expect(events.rows.map((r) => r.diff)).toEqual([{ by: 'fin' }, { by: 'phone' }, { by: 'fin' }]);
        const kept = await owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.idempotency_keys where path like '/api/v1/persons/lookup%' or path like '/api/v1/persons/duplicates%'"
        );
        expect(kept.rows[0]).toEqual({ n: 0 });
    });

    it('keeps no request fingerprint that trying values could turn back into a FIN or phone', async () => {
        // the create's idempotency record: its fingerprint is keyed (HMAC), so a plain hash of the body never matches it
        const sorted = (v: unknown): unknown =>
            Array.isArray(v)
                ? v.map(sorted)
                : v && typeof v === 'object'
                  ? Object.fromEntries(
                        Object.keys(v)
                            .sort()
                            .map((k) => [k, sorted((v as Record<string, unknown>)[k])])
                    )
                  : v;
        const { rows } = await owner.query<{ request_hash: string; unit_id: string; path: string }>(
            "select request_hash, unit_id, path from kernel.idempotency_keys where path = '/api/v1/persons'"
        );
        expect(rows.length).toBeGreaterThan(0);
        const plain = createHash('sha256')
            .update(JSON.stringify(['POST', '/api/v1/persons', units.damot.id, sorted(input)]))
            .digest('hex');
        expect(rows.map((r) => r.request_hash)).not.toContain(plain);
    });

    it('stores the sensitive fields only encrypted, and audits them only as masked indexes', async () => {
        const { rows } = await owner.query<{ birth_date_ct: Buffer; phone_ct: Buffer; fin_ct: Buffer }>(
            `select birth_date_ct, phone_ct, fin_ct from parties.person_sensitive where person_id = $1`,
            [person.id]
        );
        const [row] = rows;
        expect(row).toBeDefined();
        expect(
            Buffer.concat([row?.fin_ct ?? Buffer.alloc(0), row?.phone_ct ?? Buffer.alloc(0)]).toString('latin1')
        ).not.toContain(input.sensitive.fin);
        const audit = await owner.query<{
            table_name: string;
            action: string;
            diff: { after: Record<string, unknown> };
        }>(`select table_name, action, diff from kernel.audit_log where row_id = $1 order by at`, [person.id]);
        expect(audit.rows.map((r) => [r.table_name, r.action])).toEqual([
            ['parties.persons', 'insert'],
            ['parties.person_sensitive', 'insert']
        ]);
        const sensitiveDiff = audit.rows[1]?.diff.after ?? {};
        expect(sensitiveDiff).not.toHaveProperty('finCt');
        expect(sensitiveDiff).not.toHaveProperty('phoneCt');
        expect(sensitiveDiff.finBidx).toMatch(/^hmac:[0-9a-f]{64}$/);
        expect(sensitiveDiff.phoneBidx).toMatch(/^hmac:[0-9a-f]{64}$/);
        const everything = JSON.stringify((await owner.query('select diff from kernel.audit_log')).rows);
        expect(everything).not.toContain(input.sensitive.fin);
        expect(everything).not.toContain('911100001');
        // the region's first data key was created once, and recorded
        const keyEvents = await owner.query(
            "select count(*)::int as n from kernel.audit_log where event_type = 'crypto.data_key_created'"
        );
        expect(keyEvents.rows[0]).toEqual({ n: 1 });
    });

    it('is corrected only by the office that handles it, on the version read, with the change audited', async () => {
        const fromBoditi = await call(
            'PATCH',
            `/api/v1/persons/${person.id}`,
            boditi(),
            { sex: 'male' },
            {
                'if-match': `"${person.version}"`
            }
        );
        expect(fromBoditi.statusCode).toBe(403);
        const noVersion = await call('PATCH', `/api/v1/persons/${person.id}`, damot(), { birthYear: 1991 });
        expect(noVersion.statusCode).toBe(400);
        const corrected = await call(
            'PATCH',
            `/api/v1/persons/${person.id}`,
            damot(),
            { address: { unitId: units.damot.id, kebele: '07' }, sensitive: { phone: '0922 000111' } },
            { 'if-match': `"${person.version}"` }
        );
        expect(corrected.statusCode, corrected.body).toBe(200);
        expect(corrected.json()).toMatchObject({ version: person.version + 1, address: { kebele: '07' } });
        const drift = await call(
            'PATCH',
            `/api/v1/persons/${person.id}`,
            damot(),
            { birthYear: 1985 },
            { 'if-match': `"${person.version + 1}"` }
        );
        expect(drift.statusCode).toBe(422);
        const stale = await call(
            'PATCH',
            `/api/v1/persons/${person.id}`,
            damot(),
            { sex: 'female' },
            {
                'if-match': `"${person.version}"`
            }
        );
        expect(stale.statusCode).toBe(409);
        const audit = await owner.query<{ diff: { before: Record<string, unknown>; after: Record<string, unknown> } }>(
            `select diff from kernel.audit_log where row_id = $1 and table_name = 'parties.person_sensitive' and action = 'update'`,
            [person.id]
        );
        const change = audit.rows[0]?.diff;
        expect(change?.before.phoneBidx).toMatch(/^hmac:/);
        expect(change?.after.phoneBidx).toMatch(/^hmac:/);
        expect(change?.after.phoneBidx).not.toBe(change?.before.phoneBidx);
        expect(Object.keys(change?.after ?? {})).toEqual(['phoneBidx']);
        person = (await call('GET', `/api/v1/persons/${person.id}`, damot())).json<PersonOut>();
    });

    it('never shows a viewer its FIN or phone, and refuses them reveal', async () => {
        const viewer = { sub: SUB.viewer, unit: units.zone };
        const seen = await call('GET', `/api/v1/persons/${person.id}`, viewer);
        expect(seen.statusCode).toBe(200);
        expect(seen.body).not.toContain(input.sensitive.fin);
        expect(seen.json()).toMatchObject({ sensitive: { fin: true, phone: true } });
        const reveal = await call('POST', `/api/v1/persons/${person.id}/reveal`, viewer, {
            fields: ['fin', 'phone'],
            reason: 'checking the identity at the counter'
        });
        expect(reveal.statusCode).toBe(403);
        expect(reveal.body).not.toContain(input.sensitive.fin);
        // nor look a person up by a FIN or phone, nor check them as duplicates, nor register anyone
        expect((await call('POST', '/api/v1/persons/lookup', viewer, { fin: input.sensitive.fin })).statusCode).toBe(
            403
        );
        expect(
            (
                await call('POST', '/api/v1/persons/duplicates', viewer, {
                    nameAm: input.nameAm,
                    sensitive: { phone: input.sensitive.phone }
                })
            ).statusCode
        ).toBe(403);
        expect((await call('POST', '/api/v1/persons', viewer, generated(9))).statusCode).toBe(403);
    });

    it('reveals to a records officer with a reason and a recent second factor, and records who asked why', async () => {
        const reason = 'checking the identity at the counter';
        const old = await call(
            'POST',
            `/api/v1/persons/${person.id}/reveal`,
            { ...damot(), authAge: 900 },
            {
                fields: ['fin'],
                reason
            }
        );
        expect(old.statusCode).toBe(401);
        expect(old.json()).toMatchObject({ code: 'step_up_required' });
        const noReason = await call('POST', `/api/v1/persons/${person.id}/reveal`, damot(), {
            fields: ['fin'],
            reason: 'x'
        });
        expect(noReason.statusCode).toBe(422);
        const revealed = await call('POST', `/api/v1/persons/${person.id}/reveal`, damot(), {
            fields: ['fin', 'phone', 'birthDate'],
            reason
        });
        expect(revealed.statusCode, revealed.body).toBe(200);
        expect(revealed.json()).toEqual({ fin: input.sensitive.fin, phone: '+251922000111', birthDate: '1991-02-11' });
        const events = await owner.query<{ actor_id: string; diff: unknown }>(
            `select actor_id, diff from kernel.audit_log where event_type = 'person.revealed' and row_id = $1`,
            [person.id]
        );
        expect(events.rows).toHaveLength(1);
        expect(events.rows[0]?.diff).toEqual({ fields: ['birthDate', 'fin', 'phone'], reason });
        // the answer was not kept for replay: no idempotency record holds it
        const kept = JSON.stringify((await owner.query('select response from kernel.idempotency_keys')).rows);
        expect(kept).not.toContain(input.sensitive.fin);
    });
});

describe('duplicates', () => {
    it('are flagged before saving: the same name with the same birth date and phone, and the same FIN refused', async () => {
        const first = generated(2);
        const created = await call('POST', '/api/v1/persons', damot(), first);
        expect(created.statusCode, created.body).toBe(201);
        const { id } = created.json<PersonOut>();

        const again = { ...first, sensitive: { birthDate: first.sensitive.birthDate, phone: first.sensitive.phone } };
        const check = await call('POST', '/api/v1/persons/duplicates', boditi(), {
            nameAm: again.nameAm,
            nameEn: again.nameEn,
            sensitive: again.sensitive
        });
        expect(check.statusCode).toBe(200);
        const candidates = check.json<{ items: { person: { id: string }; reasons: string[] }[] }>().items;
        expect(candidates.map((c) => [c.person.id, c.reasons])).toEqual([[id, ['name_birth_date_phone']]]);
        const refused = await call('POST', '/api/v1/persons', boditi(), again);
        expect(refused.statusCode).toBe(422);
        expect(refused.json<{ errors: unknown[] }>().errors).toEqual([
            expect.objectContaining({ path: 'acknowledgedDuplicates', code: 'possible_duplicate', message: id })
        ]);
        // the clerk checked: another person of the same name, birth date and phone
        const acknowledged = await call('POST', '/api/v1/persons', boditi(), {
            ...again,
            acknowledgedDuplicates: [id]
        });
        expect(acknowledged.statusCode).toBe(201);

        const sameFin = await call('POST', '/api/v1/persons', boditi(), {
            ...generated(3),
            sensitive: { fin: first.sensitive.fin },
            acknowledgedDuplicates: [id]
        });
        expect(sameFin.statusCode).toBe(409);
        expect(sameFin.json()).toMatchObject({ code: 'duplicate_reference' });
    });
});

describe('a merge', () => {
    it('is asked by one person and decided by another; the duplicate then points to the record kept', async () => {
        const survivor = (await call('POST', '/api/v1/persons', damot(), generated(4))).json<PersonOut>();
        const duplicate = (
            await call('POST', '/api/v1/persons', damot(), {
                ...generated(4),
                sensitive: { fin: String(410000000004) },
                acknowledgedDuplicates: [survivor.id]
            })
        ).json<PersonOut>();
        expect(duplicate.id).toBeDefined();
        const asked = await call('POST', '/api/v1/person-merges', damot(), {
            survivorId: survivor.id,
            duplicateId: duplicate.id,
            reason: 'registered twice at the same counter'
        });
        expect(asked.statusCode, asked.body).toBe(201);
        const merge = asked.json<{ id: string; version: number; status: string }>();
        expect(merge.status).toBe('pending');

        // the records officer cannot approve (no permission); the head of the office can, but not their own request
        const byClerk = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/approval`,
            damot(),
            {},
            {
                'if-match': `"${merge.version}"`
            }
        );
        expect(byClerk.statusCode).toBe(403);
        const approved = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/approval`,
            { sub: SUB.damotHead, unit: units.damot },
            { note: 'same FIN family, same birth date' },
            { 'if-match': `"${merge.version}"` }
        );
        expect(approved.statusCode, approved.body).toBe(200);
        const decided = approved.json<{ status: string; decidedBy: string | null }>();
        expect(decided.status).toBe('approved');
        expect(decided.decidedBy).toBeTruthy();

        const closed = (await call('GET', `/api/v1/persons/${duplicate.id}`, damot())).json<PersonOut>();
        expect(closed).toMatchObject({ status: 'merged', mergedIntoId: survivor.id });
        const edit = await call(
            'PATCH',
            `/api/v1/persons/${duplicate.id}`,
            damot(),
            { sex: 'male' },
            {
                'if-match': `"${closed.version}"`
            }
        );
        expect(edit.statusCode).toBe(409);
        const events = await owner.query<{ payload: unknown }>(
            "select payload from kernel.outbox_events where type = 'person.merged.v1'"
        );
        expect(events.rows.map((r) => r.payload)).toEqual([
            { survivorId: survivor.id, duplicateId: duplicate.id, mergeId: merge.id }
        ]);
    });

    it('is refused to the person who asked for it, even when they may approve', async () => {
        const a = (await call('POST', '/api/v1/persons', damot(), generated(5))).json<PersonOut>();
        const b = (
            await call('POST', '/api/v1/persons', damot(), {
                ...generated(5),
                sensitive: {},
                acknowledgedDuplicates: [a.id]
            })
        ).json<PersonOut>();
        const head = { sub: SUB.damotHead, unit: units.damot };
        // a unit head holds person:approve-merge but not person:merge: the zone's records officer role asks here
        const asked = await call('POST', '/api/v1/person-merges', damot(), {
            survivorId: a.id,
            duplicateId: b.id,
            reason: 'registered twice at the same counter'
        });
        const merge = asked.json<{ id: string; version: number }>();
        await owner.query('update parties.person_merges set created_by = $1 where id = $2', [
            (await owner.query<{ id: string }>('select id from kernel.users where keycloak_sub = $1', [SUB.damotHead]))
                .rows[0]?.id,
            merge.id
        ]);
        const own = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/approval`,
            head,
            {},
            {
                'if-match': `"${merge.version}"`
            }
        );
        expect(own.statusCode).toBe(403);
    });
});

describe('a merge with memberships', () => {
    const DUAL = '0199f0a0-d000-7000-8000-000000000401';
    const head = () => ({ sub: SUB.damotHead, unit: units.damot });
    const org = async (as: { sub: string; unit: OrgUnit }, n: number) =>
        (
            await call('POST', '/api/v1/organisations', as, {
                kind: 'association',
                name: { am: `የሙከራ ማህበር ${n}`, en: `Test Association ${n}` }
            })
        ).json<{ id: string }>().id;
    const pair = async (n: number) => {
        const a = (
            await call('POST', '/api/v1/persons', damot(), { ...generated(n), sensitive: {} })
        ).json<PersonOut>();
        const b = (
            await call('POST', '/api/v1/persons', damot(), {
                ...generated(n),
                sensitive: {},
                acknowledgedDuplicates: [a.id]
            })
        ).json<PersonOut>();
        return { a, b };
    };
    const ask = async (survivorId: string, duplicateId: string) =>
        (
            await call('POST', '/api/v1/person-merges', damot(), {
                survivorId,
                duplicateId,
                reason: 'registered twice at the same counter'
            })
        ).json<{ id: string; version: number }>();
    const members = async (id: string) =>
        (await call('GET', `/api/v1/organisations/${id}`, damot())).json<{
            members: { person: { id: string }; role: string; until: string | null }[];
        }>().members;

    it('moves the memberships, and ends one the kept record already holds', async () => {
        const { a, b } = await pair(11);
        const first = await org(damot(), 1);
        const second = await org(damot(), 2);
        for (const [id, personId] of [
            [first, a.id],
            [first, b.id],
            [second, b.id]
        ] as const)
            expect(
                (await call('POST', `/api/v1/organisations/${id}/members`, damot(), { personId, role: 'member' }))
                    .statusCode
            ).toBe(201);
        const merge = await ask(a.id, b.id);
        const approved = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/approval`,
            head(),
            {},
            {
                'if-match': `"${merge.version}"`
            }
        );
        expect(approved.statusCode, approved.body).toBe(200);
        // the first: the kept record was a member already, so the duplicate's membership ended
        expect((await members(first)).map((m) => [m.person.id, m.until === null])).toEqual([
            [a.id, true],
            [b.id, false]
        ]);
        // the second: the membership moved to the kept record
        expect((await members(second)).map((m) => [m.person.id, m.until])).toEqual([[a.id, null]]);
    });

    it('is refused, before anything changes, when a membership is in an organisation another office handles', async () => {
        const { a, b } = await pair(12);
        const zone = { sub: DUAL, unit: units.zone };
        const zoneOrg = await org(zone, 3);
        expect(
            (await call('POST', `/api/v1/organisations/${zoneOrg}/members`, zone, { personId: b.id, role: 'member' }))
                .statusCode
        ).toBe(201);
        const merge = await ask(a.id, b.id);
        const refused = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/approval`,
            head(),
            {},
            {
                'if-match': `"${merge.version}"`
            }
        );
        expect(refused.statusCode).toBe(409);
        expect((await call('GET', `/api/v1/persons/${b.id}`, damot())).json<PersonOut>().status).toBe('active');
        // a rejection closes the request and changes no record
        const rejected = await call(
            'POST',
            `/api/v1/person-merges/${merge.id}/rejection`,
            head(),
            { note: 'ask the zone' },
            { 'if-match': `"${merge.version}"` }
        );
        expect(rejected.json<{ status: string }>().status).toBe('rejected');
        expect((await call('GET', `/api/v1/persons/${b.id}`, damot())).json<PersonOut>().status).toBe('active');
    });
});

describe('organisations', () => {
    it('are registered with a unique TIN, found by name or TIN, and hold members', async () => {
        const org = {
            kind: 'association',
            name: { am: 'የሙከራ ታክሲ ማህበር', en: 'Test Taxi Association' },
            tin: '0000012345',
            address: { unitId: units.damot.id }
        };
        const created = await call('POST', '/api/v1/organisations', damot(), org);
        expect(created.statusCode, created.body).toBe(201);
        const { id } = created.json<{ id: string }>();
        expect((await call('POST', '/api/v1/organisations', boditi(), org)).statusCode).toBe(409);
        for (const q of ['ታክሲ ማህበር', 'taxi', '0000012345']) {
            const found = await call('GET', `/api/v1/organisations?q=${encodeURIComponent(q)}`, boditi());
            expect(ids(found), q).toContain(id);
        }
        const member = (await call('POST', '/api/v1/persons', damot(), generated(6))).json<PersonOut>();
        const withMember = await call('POST', `/api/v1/organisations/${id}/members`, damot(), {
            personId: member.id,
            role: 'chair',
            since: '2026-07-08'
        });
        expect(withMember.statusCode, withMember.body).toBe(201);
        const members = withMember.json<{ members: { role: string; since: string; person: { id: string } }[] }>()
            .members;
        expect(members.map((m) => [m.role, m.since, m.person.id])).toEqual([['chair', '2026-07-08', member.id]]);
        // another office reads it, and cannot change it
        expect(
            (
                await call('POST', `/api/v1/organisations/${id}/members`, boditi(), {
                    personId: member.id,
                    role: 'member'
                })
            ).statusCode
        ).toBe(403);
    });
});
