/**
 * Forms (task 0.16a), over HTTP on a real PostgreSQL 16 with the Wolaita seeds, Test Zone B and Test Region X: a bureau's
 * form is checked against the engine's contract, read by every office of the region and by no other region; it is
 * published only when a second person approves; a published version never changes; a submission is checked on the
 * server with the browser's engine (the shared case file), keeps the version it was filled on, and is seen only in its
 * unit's subtree. Every write is audited, with the documents left out of the log.
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { SLICES } from '../../src/slices';
import { startPostgres, type TestPostgres } from './support/postgres';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(HERE, '..', '..', 'seed');
const FIXTURES = join(HERE, '..', 'fixtures', 'org');
const CASES = join(HERE, '..', '..', '..', '..', 'packages', 'form-engine', 'test', 'cases.json');
const ISSUER = 'http://keycloak.test/realms/itrms';
const AUDIENCE = 'itrms-api';
const SUB = {
    bureauAdmin: '0199f0a0-d000-7000-8000-000000000001',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    // demo.dual: records officer in the zone
    zoneRecords: '0199f0a0-d000-7000-8000-000000000401',
    bureauAdmin2: '0199f0a0-d000-7000-8000-00000000f101',
    damotHeadRecords: '0199f0a0-d000-7000-8000-00000000f102',
    zoneViewer: '0199f0a0-d000-7000-8000-00000000f103',
    tzbHead: '0199f0a0-d000-7000-8000-00000000f104',
    trxRecords: '0199f0a0-d000-7000-8000-00000000f106'
};

type UnitKey = 'ser' | 'zone' | 'damot' | 'boditi' | 'tzb' | 'trx';

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let http: NestFastifyApplication;
let sign: (sub: string) => Promise<string>;
const units = {} as Record<UnitKey, OrgUnit>;

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
    const user = (username: string, sub: string, home: string, roles: [string, string][]) => ({
        username,
        displayName: `${username} (test)`,
        keycloakSub: sub,
        home,
        roles: roles.map(([unit, role]) => ({ unit, role }))
    });
    await installer.scoped({}, (tx) =>
        importUsers(tx, {
            region: 'SER',
            users: [
                user('test.bureau.admin2', SUB.bureauAdmin2, 'SER', [['SER', 'bureau_admin']]),
                user('test.damot.head.records', SUB.damotHeadRecords, 'WOL-DAMOT-GALE', [
                    ['WOL-DAMOT-GALE', 'unit_head'],
                    ['WOL-DAMOT-GALE', 'records_officer']
                ]),
                user('test.zone.viewer', SUB.zoneViewer, 'WOL', [['WOL', 'viewer']]),
                user('test.tzb.head', SUB.tzbHead, 'TZB', [['TZB', 'unit_head']])
            ]
        })
    );
    // Test Region X's district offices have no roles in their fixture: this test gives them a records officer
    await owner.query(`insert into kernel.unit_type_roles (id, region_id, unit_type_id, role_key, delegable)
        select gen_random_uuid(), t.region_id, t.id, 'records_officer', false from kernel.unit_types t
         where t.key = 'district_office'`);
    await installer.scoped({}, (tx) =>
        importUsers(tx, {
            region: 'TRX',
            users: [user('test.trx.records', SUB.trxRecords, 'TRX-W1', [['TRX-W1', 'records_officer']])]
        })
    );
    units.ser = await unitAt('SER', 'SER');
    units.zone = await unitAt('SER', 'WOL');
    units.damot = await unitAt('SER', 'WOL-DAMOT-GALE');
    units.boditi = await unitAt('SER', 'WOL-BODITI');
    units.tzb = await unitAt('SER', 'TZB');
    units.trx = await unitAt('TRX', 'TRX-W1');

    const realm = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
    sign = (sub) =>
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
                        shell: { manifests: installed.manifests, messages: installed.messages }
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

interface As {
    sub: string;
    unit: OrgUnit;
}
const as = {
    bureau: (): As => ({ sub: SUB.bureauAdmin, unit: units.ser }),
    bureau2: (): As => ({ sub: SUB.bureauAdmin2, unit: units.ser }),
    zoneAdmin: (): As => ({ sub: SUB.zoneAdmin, unit: units.zone }),
    zoneHead: (): As => ({ sub: SUB.zoneHead, unit: units.zone }),
    zoneRecords: (): As => ({ sub: SUB.zoneRecords, unit: units.zone }),
    zoneViewer: (): As => ({ sub: SUB.zoneViewer, unit: units.zone }),
    damot: (): As => ({ sub: SUB.damotRecords, unit: units.damot }),
    damotHead: (): As => ({ sub: SUB.damotHeadRecords, unit: units.damot }),
    boditi: (): As => ({ sub: SUB.boditiRecords, unit: units.boditi }),
    tzb: (): As => ({ sub: SUB.tzbHead, unit: units.tzb }),
    trx: (): As => ({ sub: SUB.trxRecords, unit: units.trx })
};

async function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    who: As,
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
                authorization: `Bearer ${await sign(who.sub)}`,
                'x-org-unit': who.unit.id,
                'accept-language': 'en',
                ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
                ...headers
            },
            payload: body
        });
}
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

interface Problem {
    code: string;
    detail?: string;
    errors: { path: string; code: string; message: string }[];
}
interface FormOut {
    id: string;
    version: number;
    status: string;
    publishedVersion: { id: string; number: number } | null;
    document: unknown;
    documentHash: string;
}
interface PublicationOut {
    id: string;
    version: number;
    status: string;
    formVersion: { id: string; number: number };
}
interface SubmissionOut {
    id: string;
    formVersion: { id: string; number: number };
    answers: Record<string, unknown>;
    handlingUnit: { code: string };
    submittedBy: string | null;
    submittedByName: string | null;
}

const text = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    props: {},
    behavior: { validation: { supported: true } },
    ...extra
});
const required = (id: string) => text(id, { props: { required: true } });
const V1 = { schemaVersion: 2, fields: [required('fullName'), text('phone')] };
const V2 = { schemaVersion: 2, fields: [required('fullName'), text('phone'), required('kebele')] };

async function createForm(who: As, key: string, document: unknown = V1): Promise<FormOut> {
    const res = await call('POST', '/api/v1/forms', who, {
        key,
        name: { am: `ቅጽ ${key}`, en: `Form ${key}` },
        document
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FormOut>();
}

/** Ask (as `maker`) and approve (as `checker`): the working copy becomes the published version. */
async function publish(formId: string, maker: As, checker: As): Promise<PublicationOut> {
    const asked = await call('POST', `/api/v1/forms/${formId}/publications`, maker, { note: 'ready' });
    expect(asked.statusCode, asked.body).toBe(201);
    const publication = asked.json<PublicationOut>();
    const approved = await call(
        'POST',
        `/api/v1/form-publications/${publication.id}/approval`,
        checker,
        {},
        ifMatch(publication.version)
    );
    expect(approved.statusCode, approved.body).toBe(200);
    return approved.json<PublicationOut>();
}

const submit = (who: As, formId: string, formVersionId: string, answers: Record<string, unknown>) =>
    call('POST', '/api/v1/submissions', who, { formId, formVersionId, answers });

const get = async <T>(url: string, who: As) => {
    const res = await call('GET', url, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<T>();
};

describe('a bureau form', () => {
    let form: FormOut;

    beforeAll(async () => {
        form = await createForm(as.bureau(), 'licence-application');
    });

    it('is refused when the engine cannot read it, and its key is unique in the region', async () => {
        const bad = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'broken',
            name: { am: 'የተበላሸ', en: 'Broken' },
            document: { fields: [text('a', { type: 'Nope' }), text('b'), text('b'), text('c', { parentId: 'gone' })] }
        });
        expect(bad.statusCode).toBe(422);
        expect(bad.json()).toMatchObject({ code: 'validation_failed' });
        expect(bad.json<Problem>().errors[0]).toMatchObject({
            path: 'document.fields[0].type',
            message: '"Nope" is not a field type this version knows'
        });
        const loop = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'loop',
            name: { am: 'ዙር', en: 'Loop' },
            document: { fields: [text('b'), text('b'), text('c', { parentId: 'gone' })] }
        });
        expect(loop.json<Problem>().errors.map((e: { path: string }) => e.path)).toEqual([
            'document.fields[1].id',
            'document.fields[2].parentId'
        ]);
        const twice = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'licence-application',
            name: { am: 'ሁለተኛ', en: 'Again' },
            document: V1
        });
        expect(twice.statusCode).toBe(409);
        expect(twice.json<Problem>().code).toBe('duplicate_reference');
        // the same key is free in another region
        await owner.query(
            `insert into forms.form_definitions (id, region_id, owner_unit_id, key, name, document, document_hash)
             values ($1, $2, $3, 'licence-application', '{"am":"ቅጽ","en":"Form"}', '{"fields":[]}', repeat('0', 64))`,
            [randomUUID(), units.trx.regionId, units.trx.id]
        );
    });

    it('is read by every office of the region, and by no other region', async () => {
        expect(form.status).toBe('draft');
        for (const who of [as.damot(), as.boditi(), as.tzb(), as.zoneViewer()])
            expect((await call('GET', `/api/v1/forms/${form.id}`, who)).statusCode).toBe(200);
        expect((await call('GET', `/api/v1/forms/${form.id}`, as.trx())).statusCode).toBe(404);
        const listed = await get<{ items: { id: string }[] }>('/api/v1/forms?q=licence', as.trx());
        expect(listed.items.map((f) => f.id)).not.toContain(form.id);
    });

    it('is changed only by its own office and those above it', async () => {
        const fromZone = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.zoneAdmin(),
            { name: { am: 'ሌላ', en: 'Other' } },
            ifMatch(form.version)
        );
        expect(fromZone.statusCode).toBe(403);
        const stale = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.bureau(),
            { category: 'licensing' },
            ifMatch(form.version + 1)
        );
        expect(stale.json<Problem>().code).toBe('stale_version');
        const viewer = await call('POST', `/api/v1/forms/${form.id}/publications`, as.zoneViewer(), {});
        expect(viewer.statusCode).toBe(403);
    });

    it('takes no submissions before it is published', async () => {
        const res = await submit(as.damot(), form.id, randomUUID(), { fullName: 'Hana' });
        expect(res.statusCode).toBe(409);
        expect(res.json<Problem>().code).toBe('not_configured');
        expect(
            (await call('GET', `/api/v1/forms/${form.id}/versions/published`, as.damot())).json<Problem>().code
        ).toBe('not_configured');
    });

    it('is published only when a second person approves', async () => {
        const asked = await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau(), { note: 'First' });
        expect(asked.statusCode, asked.body).toBe(201);
        const publication = asked.json<PublicationOut>();
        expect(publication).toMatchObject({ status: 'pending', formVersion: { number: 1 } });
        expect((await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau())).status).toBe('pending');
        const twice = await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau(), {});
        expect(twice.json<Problem>().code).toBe('invalid_transition');

        // the maker cannot approve, a records officer may not, an office below does not see the request
        const own = await call(
            'POST',
            `/api/v1/form-publications/${publication.id}/approval`,
            as.bureau(),
            {},
            ifMatch(publication.version)
        );
        expect(own.statusCode).toBe(403);
        const denial = await owner.query(
            "select diff from kernel.audit_log where action = 'event' and diff::text like $1",
            [`%${publication.id}%`]
        );
        expect(JSON.stringify(denial.rows)).toContain('separation_of_duties');
        expect(
            (
                await call(
                    'POST',
                    `/api/v1/form-publications/${publication.id}/approval`,
                    as.damot(),
                    {},
                    ifMatch(publication.version)
                )
            ).statusCode
        ).toBe(403);
        const fromZone = await call(
            'POST',
            `/api/v1/form-publications/${publication.id}/approval`,
            as.zoneHead(),
            {},
            ifMatch(publication.version)
        );
        expect(fromZone.statusCode).toBe(404);

        const approved = await call(
            'POST',
            `/api/v1/form-publications/${publication.id}/approval`,
            as.bureau2(),
            { note: 'Checked' },
            ifMatch(publication.version)
        );
        expect(approved.statusCode, approved.body).toBe(200);
        expect(approved.json()).toMatchObject({ status: 'approved', decisionNote: 'Checked' });
        form = await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau());
        expect(form).toMatchObject({ status: 'published', publishedVersion: { number: 1 } });
        const live = await get<{ id: string; document: unknown }>(
            `/api/v1/forms/${form.id}/versions/published`,
            as.damot()
        );
        expect(live).toMatchObject({ id: form.publishedVersion?.id, document: V1 });
        const event = await owner.query<{ payload: unknown }>(
            "select payload from kernel.outbox_events where type = 'form.published.v1'"
        );
        expect(event.rows.map((r) => r.payload)).toContainEqual(
            expect.objectContaining({ formId: form.id, formVersionId: live.id, previousVersionId: null })
        );
        const again = await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau(), {});
        expect(again.json<Problem>().code).toBe('invalid_transition');
        expect(again.json<Problem>().detail).toMatch(/already/);
    });

    it('refuses, via a direct API call, a submission that breaks a rule (422)', async () => {
        const versionId = form.publishedVersion?.id ?? '';
        const res = await submit(as.damot(), form.id, versionId, { phone: '0911000000' });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({
            code: 'validation_failed',
            errors: [{ path: 'fullName', code: 'invalid', message: 'This field is required' }]
        });
        expect((await owner.query('select count(*)::int as n from forms.submissions')).rows[0]).toEqual({ n: 0 });
        // only the form's own fields are kept
        const ok = await submit(as.damot(), form.id, versionId, { fullName: 'Hana', status: 'approved', x: 1 });
        expect(ok.statusCode, ok.body).toBe(201);
        expect(ok.json<SubmissionOut>()).toMatchObject({
            answers: { fullName: 'Hana' },
            formVersion: { id: versionId, number: 1 },
            handlingUnit: { code: 'WOL-DAMOT-GALE' }
        });
    });

    it('never changes a published version', async () => {
        const versionId = form.publishedVersion?.id ?? '';
        const edited = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.bureau(),
            { document: V2 },
            ifMatch(form.version)
        );
        expect(edited.statusCode, edited.body).toBe(200);
        form = edited.json<FormOut>();
        expect(form).toMatchObject({ status: 'draft', publishedVersion: { id: versionId } });
        expect(
            (await get<{ document: unknown }>(`/api/v1/forms/${form.id}/versions/${versionId}`, as.damot())).document
        ).toEqual(V1);

        // not through the API's role (no grant), nor the owner's (the trigger), however asked
        const asApp = new Client({ connectionString: pg.url('app') });
        await asApp.connect();
        try {
            await expect(
                asApp.query(`update forms.form_versions set document = '{}'::jsonb where id = $1`, [versionId])
            ).rejects.toThrow(/permission denied/);
            await expect(asApp.query(`delete from forms.form_versions where id = $1`, [versionId])).rejects.toThrow(
                /permission denied/
            );
        } finally {
            await asApp.end();
        }
        for (const statement of [
            `update forms.form_versions set document = '{}'::jsonb where id = '${versionId}'`,
            `update forms.form_versions set content_hash = repeat('0', 64) where id = '${versionId}'`,
            `delete from forms.form_versions where id = '${versionId}'`,
            'truncate forms.form_versions cascade'
        ])
            await expect(owner.query(statement), statement).rejects.toThrow(/immutable/);
        // a unit move may still rewrite its scope
        await owner.query(`update forms.form_versions set org_path = org_path where id = $1`, [versionId]);
    });

    it('keeps a submission on the version it was filled on after a new one is published', async () => {
        const v1 = form.publishedVersion?.id ?? '';
        const first = (await submit(as.damot(), form.id, v1, { fullName: 'Abebe' })).json<SubmissionOut>();
        const published = await publish(form.id, as.bureau(), as.bureau2());
        expect(published.formVersion.number).toBe(2);
        const kept = await get<SubmissionOut>(`/api/v1/submissions/${first.id}`, as.damot());
        expect(kept.formVersion).toEqual({ id: v1, number: 1 });
        expect(kept.answers).toEqual({ fullName: 'Abebe' });
        // a new submission is made on the published version only
        const late = await submit(as.damot(), form.id, v1, { fullName: 'Late' });
        expect(late.statusCode).toBe(409);
        expect(late.json<Problem>().code).toBe('stale_version');
        const v2 = published.formVersion.id;
        expect((await submit(as.damot(), form.id, v2, { fullName: 'Abebe' })).json<Problem>().errors).toEqual([
            { path: 'kebele', code: 'invalid', message: 'This field is required' }
        ]);
        expect((await submit(as.damot(), form.id, v2, { fullName: 'Abebe', kebele: '04' })).statusCode).toBe(201);
    });

    it('stays on its published version when a publication is rejected; the same content reuses its version', async () => {
        form = await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau());
        const live = form.publishedVersion;
        const toV1 = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.bureau(),
            { document: V1 },
            ifMatch(form.version)
        );
        expect(toV1.statusCode).toBe(200);
        const asked = (
            await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau(), {})
        ).json<PublicationOut>();
        // back to the first content: its version, not a third
        expect(asked.formVersion.number).toBe(1);
        // a rejection says why
        const unexplained = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/rejection`,
            as.bureau2(),
            {},
            ifMatch(asked.version)
        );
        expect(unexplained.statusCode).toBe(422);
        const rejected = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/rejection`,
            as.bureau2(),
            { note: 'Keep the kebele' },
            ifMatch(asked.version)
        );
        expect(rejected.json()).toMatchObject({ status: 'rejected' });
        form = await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau());
        expect(form).toMatchObject({ status: 'draft', publishedVersion: { id: live?.id, number: 2 } });
        const versions = await get<{ items: { number: number; published: boolean }[] }>(
            `/api/v1/forms/${form.id}/versions`,
            as.damot()
        );
        expect(versions.items.map((v) => [v.number, v.published])).toEqual([
            [2, true],
            [1, false]
        ]);
        const decided = await get<{ items: PublicationOut[] }>(
            `/api/v1/form-publications?status=rejected&formId=${form.id}`,
            as.bureau()
        );
        expect(decided.items.map((p) => p.id)).toEqual([asked.id]);
    });

    it('audits every write in its transaction, without the documents', async () => {
        const rows = (
            await owner.query<{ table_name: string; action: string; diff: Record<string, Record<string, unknown>> }>(
                `select table_name, action, diff from kernel.audit_log
                  where table_name like 'forms.%' and row_id in (
                        select $1::uuid union all select id from forms.form_versions where form_id = $1
                        union all select id from forms.form_publications where form_id = $1
                        union all select id from forms.submissions where form_id = $1)
                  order by at, id`,
                [form.id]
            )
        ).rows;
        const kinds = new Set(rows.map((r) => `${r.table_name}:${r.action}`));
        for (const kind of [
            'forms.form_definitions:insert',
            'forms.form_definitions:update',
            'forms.form_versions:insert',
            'forms.form_publications:insert',
            'forms.form_publications:update',
            'forms.submissions:insert'
        ])
            expect(kinds, kind).toContain(kind);
        const created = rows.find((r) => r.table_name === 'forms.form_definitions' && r.action === 'insert');
        expect(created?.diff.after).toHaveProperty('documentHash');
        for (const r of rows) {
            expect(r.diff.after ?? {}).not.toHaveProperty('document');
            expect(r.diff.before ?? {}).not.toHaveProperty('document');
        }
        // answers hold personal data and role-restricted values: the log proves a change without holding them
        const submission = rows.find((r) => r.table_name === 'forms.submissions');
        expect(submission?.diff.after?.answers).toMatch(/^hmac:[0-9a-f]{64}$/);
    });
});

describe('a publication', () => {
    it('is decided neither by who asked nor by who wrote the content, and only who asked withdraws it', async () => {
        // the first bureau admin writes the form; the second asks for it to go live
        const form = await createForm(as.bureau(), 'inspection-checklist');
        const asked = (
            await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau2(), {})
        ).json<PublicationOut>();
        const byAuthor = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/approval`,
            as.bureau(),
            {},
            ifMatch(asked.version)
        );
        expect(byAuthor.statusCode).toBe(403);
        expect(byAuthor.json<Problem>().detail).toMatch(/changed the form/);
        const byOther = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/withdrawal`,
            as.bureau(),
            {},
            ifMatch(asked.version)
        );
        expect(byOther.statusCode).toBe(403);
        const withdrawn = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/withdrawal`,
            as.bureau2(),
            {},
            ifMatch(asked.version)
        );
        expect(withdrawn.json()).toMatchObject({ status: 'withdrawn' });
        expect((await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau())).status).toBe('draft');
        // the database refuses it too
        await expect(
            owner.query(
                `update forms.form_publications set status = 'approved', decided_by = content_by, decided_at = now()
                  where id = $1`,
                [asked.id]
            )
        ).rejects.toThrow(/four_eyes/);
    });

    it('tells a reader without the right to decide that they cannot', async () => {
        // a zone form, asked for by the zone's admin: the zone's viewer reads the request but holds no form:approve
        const form = await createForm(as.zoneAdmin(), 'zone-checklist');
        const asked = (
            await call('POST', `/api/v1/forms/${form.id}/publications`, as.zoneAdmin(), {})
        ).json<PublicationOut>();
        const seen = await get<{ items: (PublicationOut & { canDecide: boolean; canWithdraw: boolean })[] }>(
            `/api/v1/form-publications?formId=${form.id}`,
            as.zoneViewer()
        );
        expect(seen.items.find((p) => p.id === asked.id)).toMatchObject({ canDecide: false, canWithdraw: false });
    });

    it('is listed for its approvers while it waits, and is refused once its form is switched off', async () => {
        // the legacy "approving a deleted form is refused": forms are switched off, never deleted
        const form = await createForm(as.bureau(), 'retired-form');
        const asked = (
            await call('POST', `/api/v1/forms/${form.id}/publications`, as.bureau(), {})
        ).json<PublicationOut>();
        const waiting = await get<{ items: PublicationOut[] }>('/api/v1/form-publications', as.bureau2());
        expect(waiting.items.map((p) => p.id)).toContain(asked.id);
        // the inbox names who asked, and says what each caller may do with it
        expect(waiting.items.find((p) => p.id === asked.id)).toMatchObject({
            requestedByName: expect.any(String) as unknown,
            canDecide: true,
            canWithdraw: false
        });
        const own = await get<{ items: PublicationOut[] }>('/api/v1/form-publications', as.bureau());
        expect(own.items.find((p) => p.id === asked.id)).toMatchObject({ canDecide: false, canWithdraw: true });
        // an office below the form's owner does not see the request
        const below = await get<{ items: PublicationOut[] }>('/api/v1/form-publications', as.zoneHead());
        expect(below.items.map((p) => p.id)).not.toContain(asked.id);
        const current = await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau());
        const off = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.bureau(),
            { active: false },
            ifMatch(current.version)
        );
        expect(off.statusCode).toBe(200);
        const approved = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/approval`,
            as.bureau2(),
            {},
            ifMatch(asked.version)
        );
        expect(approved.statusCode).toBe(409);
        expect(approved.json<Problem>().code).toBe('invalid_transition');
        expect((await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau())).publishedVersion).toBeNull();
        // the withdrawal is on record like every other write
        const withdrawn = await call(
            'POST',
            `/api/v1/form-publications/${asked.id}/withdrawal`,
            as.bureau(),
            {},
            ifMatch(asked.version)
        );
        expect(withdrawn.json()).toMatchObject({ status: 'withdrawn' });
        const audit = await owner.query<{ diff: { after: Record<string, unknown> } }>(
            `select diff from kernel.audit_log where row_id = $1 and action = 'update'`,
            [asked.id]
        );
        expect(audit.rows.map((r) => r.diff.after.status)).toEqual(['withdrawn']);
    });

    it('of a form above the office is refused the same way as a change to it', async () => {
        const bureauForm = (await get<{ items: FormOut[] }>('/api/v1/forms?q=inspection', as.zoneAdmin())).items[0];
        const res = await call('POST', `/api/v1/forms/${bureauForm?.id ?? ''}/publications`, as.zoneAdmin(), {});
        expect(res.statusCode).toBe(403);
    });
});

describe('limits', () => {
    it('refuse long names, deep nesting and NUL characters with a 422, never a 500', async () => {
        const long = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'long-name',
            name: { am: 'ሀ'.repeat(201), en: 'Long' },
            document: V1
        });
        expect(long.statusCode).toBe(422);
        let deep: unknown = 'x';
        for (let i = 0; i < 20; i++) deep = { deep };
        const form = await createForm(as.bureau(), 'limits');
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        for (const answers of [{ fullName: deep }, { fullName: 'a\u0000b' }, { phone: Array(6000).fill(1) }]) {
            const res = await submit(as.damot(), form.id, versionId, answers);
            expect(res.statusCode, res.body).toBe(422);
        }
    });
});

describe('submissions', () => {
    let form: FormOut;
    let versionId: string;
    const made: Record<'damot' | 'boditi' | 'zone', string> = { damot: '', boditi: '', zone: '' };

    beforeAll(async () => {
        form = await createForm(as.bureau(), 'bolo-request', {
            fields: [
                required('plate'),
                // the unit head's own remark: never shown to (nor taken from) anyone else
                text('internal', { visibleToRoles: ['unit_head'] })
            ]
        });
        versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        for (const [key, who] of [
            ['damot', as.damot()],
            ['boditi', as.boditi()],
            ['zone', as.zoneRecords()]
        ] as const) {
            const res = await submit(who, form.id, versionId, { plate: `ETH ${key.toUpperCase()}`, internal: 'typed' });
            expect(res.statusCode, res.body).toBe(201);
            made[key] = res.json<SubmissionOut>().id;
        }
    });

    it('are seen in the unit and the offices above it, not by a sibling, another zone or region', async () => {
        const seen = async (who: As) =>
            (await get<{ items: SubmissionOut[] }>(`/api/v1/submissions?formId=${form.id}`, who)).items.map(
                (s) => s.handlingUnit.code
            );
        expect(await seen(as.damot())).toEqual(['WOL-DAMOT-GALE']);
        expect(await seen(as.boditi())).toEqual(['WOL-BODITI']);
        expect((await seen(as.zoneHead())).sort()).toEqual(['WOL', 'WOL-BODITI', 'WOL-DAMOT-GALE']);
        expect(await seen(as.tzb())).toEqual([]);
        for (const who of [as.boditi(), as.tzb(), as.trx()])
            expect((await call('GET', `/api/v1/submissions/${made.damot}`, who)).statusCode).toBe(404);
        // reading submissions is a permission of its own
        expect((await call('GET', `/api/v1/submissions/${made.damot}`, as.zoneViewer())).statusCode).toBe(403);
        // another region cannot even reach the form
        expect((await submit(as.trx(), form.id, versionId, { plate: 'X' })).statusCode).toBe(404);
    });

    it('are paged newest first, and "mine" lists only the caller\'s', async () => {
        const first = await get<{ items: SubmissionOut[]; next: string | null }>(
            `/api/v1/submissions?formId=${form.id}&limit=2`,
            as.zoneHead()
        );
        expect(first.items.map((s) => s.id)).toEqual([made.zone, made.boditi]);
        const rest = await get<{ items: SubmissionOut[]; next: string | null }>(
            `/api/v1/submissions?formId=${form.id}&limit=2&before=${first.next}`,
            as.zoneHead()
        );
        expect(rest).toMatchObject({ items: [{ id: made.damot }], next: null });
        const mine = await get<{ items: SubmissionOut[] }>(
            `/api/v1/submissions?formId=${form.id}&mine=true`,
            as.zoneRecords()
        );
        expect(mine.items.map((s) => s.id)).toEqual([made.zone]);
        expect(mine.items[0]?.submittedByName).toEqual(expect.any(String));
        // across forms, only one's own: everything in the unit's view needs a form to look at
        const acrossForms = await get<{ items: SubmissionOut[] }>('/api/v1/submissions?mine=true', as.zoneRecords());
        expect(acrossForms.items.map((s) => s.id)).toContain(made.zone);
        expect(acrossForms.items.every((s) => s.submittedBy === acrossForms.items[0]?.submittedBy)).toBe(true);
        expect((await call('GET', '/api/v1/submissions', as.zoneRecords())).statusCode).toBe(422);
    });

    it('keep the values of a field restricted to other roles on the server', async () => {
        // a records officer may not see the remark: what they typed into it was not taken
        const stored = await owner.query<{ answers: unknown }>('select answers from forms.submissions where id = $1', [
            made.damot
        ]);
        expect(stored.rows[0]?.answers).toEqual({ plate: 'ETH DAMOT' });
        const head = await submit(as.damotHead(), form.id, versionId, {
            plate: 'ETH HEAD',
            internal: 'only for heads'
        });
        expect(head.statusCode, head.body).toBe(201);
        const id = head.json<SubmissionOut>().id;
        expect(head.json<SubmissionOut>().answers).toEqual({ plate: 'ETH HEAD', internal: 'only for heads' });
        expect((await get<SubmissionOut>(`/api/v1/submissions/${id}`, as.damot())).answers).toEqual({
            plate: 'ETH HEAD'
        });
        expect((await get<SubmissionOut>(`/api/v1/submissions/${id}`, as.zoneHead())).answers).toEqual({
            plate: 'ETH HEAD',
            internal: 'only for heads'
        });
    });

    it('are refused on a switched-off form', async () => {
        const current = await get<FormOut>(`/api/v1/forms/${form.id}`, as.bureau());
        const off = await call(
            'PATCH',
            `/api/v1/forms/${form.id}`,
            as.bureau(),
            { active: false },
            ifMatch(current.version)
        );
        expect(off.statusCode).toBe(200);
        const res = await submit(as.damot(), form.id, versionId, { plate: 'ETH X' });
        expect(res.json<Problem>().code).toBe('invalid_transition');
    });
});

describe('a form of a zone', () => {
    it('is made and approved in the zone, filled in below it, and invisible to another zone', async () => {
        const form = await createForm(as.zoneAdmin(), 'zone-safety-club');
        expect((await call('GET', `/api/v1/forms/${form.id}`, as.tzb())).statusCode).toBe(404);
        expect((await call('GET', `/api/v1/forms/${form.id}`, as.bureau())).statusCode).toBe(200);
        const published = await publish(form.id, as.zoneAdmin(), as.zoneHead());
        const res = await submit(as.boditi(), form.id, published.formVersion.id, { fullName: 'Club' });
        expect(res.statusCode, res.body).toBe(201);
        expect((await submit(as.trx(), form.id, published.formVersion.id, { fullName: 'Club' })).statusCode).toBe(404);
    });
});

describe('the shared validation cases (packages/form-engine/test/cases.json)', () => {
    const { cases } = JSON.parse(readFileSync(CASES, 'utf8')) as {
        cases: {
            name: string;
            fields: unknown[];
            values: Record<string, unknown>;
            errors: Record<string, string>;
            stored: Record<string, unknown>;
        }[];
    };

    it.each(cases.map((c, i) => [c.name, c, i] as const))('%s: the server answers as the browser', async (_n, c, i) => {
        const form = await createForm(as.bureau(), `case-${i + 1}`, { fields: c.fields });
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        // the engine's default language, as the cases are written in it
        const res = await call(
            'POST',
            '/api/v1/submissions',
            as.damot(),
            { formId: form.id, formVersionId: versionId, answers: c.values },
            { 'accept-language': 'am' }
        );
        if (Object.keys(c.errors).length === 0) {
            expect(res.statusCode, res.body).toBe(201);
            expect(res.json<SubmissionOut>().answers).toEqual(c.stored);
        } else {
            expect(res.statusCode, res.body).toBe(422);
            const errors = res.json<{ errors: { path: string; message: string }[] }>().errors;
            expect(Object.fromEntries(errors.map((e) => [e.path, e.message]))).toEqual(c.errors);
        }
    });
});

describe('texts in every language', () => {
    const named = text('fullName', {
        label: { am: 'ሙሉ ስም', en: 'Full name' },
        props: { required: true },
        behavior: {
            validation: { supported: true, errorMessages: { required: { am: 'ስም ያስፈልጋል', en: 'A name is required' } } }
        }
    });

    it("gives an author's message in the caller's language (Amharic, English, and Amharic for Wolaytta)", async () => {
        const form = await createForm(as.bureau(), 'texts-422', { fields: [named] });
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        const messageIn = async (language: string) => {
            const res = await call(
                'POST',
                '/api/v1/submissions',
                as.damot(),
                { formId: form.id, formVersionId: versionId, answers: { fullName: '' } },
                { 'accept-language': language }
            );
            expect(res.statusCode, res.body).toBe(422);
            return res.json<Problem>().errors.map((e) => e.message);
        };
        expect(await messageIn('en')).toEqual(['A name is required']);
        expect(await messageIn('am')).toEqual(['ስም ያስፈልጋል']);
        expect(await messageIn('wal-Latn')).toEqual(['ስም ያስፈልጋል']);
    });

    it('refuses a malformed text when the form is saved, naming where it is', async () => {
        const res = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'texts-bad',
            name: { am: 'ቅጽ', en: 'Form' },
            document: { fields: [text('a', { label: { am: 1 } }), text('b', { label: { 'not a tag': 'x' } })] }
        });
        expect(res.statusCode, res.body).toBe(422);
        const paths = res.json<Problem>().errors.map((e) => e.path);
        expect(paths[0]).toBe('document.fields[0].label');
        expect(paths).toContain('document.fields[1].label');
    });
});

describe('conditional rules, the Ethiopian date and recomputed values (task 0.17b)', () => {
    const num = (id: string, extra: Record<string, unknown> = {}) => text(id, { type: 'InputNumber', ...extra });
    const submitTo = async (formId: string, versionId: string, answers: Record<string, unknown>) =>
        call('POST', '/api/v1/submissions', as.damot(), { formId, formVersionId: versionId, answers });

    it('enforces a conditional-required rule (422 with the field and the message), and files it when not met', async () => {
        const form = await createForm(as.bureau(), 'rules-required-when', {
            fields: [
                num('grade'),
                text('medicalCertificate', {
                    behavior: {
                        validation: {
                            supported: true,
                            requiredWhen: { expression: 'form.grade >= 3' },
                            errorMessages: {
                                required: { am: 'የሕክምና ማስረጃ ያስፈልጋል', en: 'A medical certificate is required' }
                            }
                        }
                    }
                })
            ]
        });
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        const refused = await call(
            'POST',
            '/api/v1/submissions',
            as.damot(),
            { formId: form.id, formVersionId: versionId, answers: { grade: 4 } },
            { 'accept-language': 'en' }
        );
        expect(refused.statusCode, refused.body).toBe(422);
        expect(refused.json<Problem>().errors).toEqual([
            expect.objectContaining({
                path: 'medicalCertificate',
                message: 'A medical certificate is required'
            })
        ]);
        expect((await submitTo(form.id, versionId, { grade: 2 })).statusCode).toBe(201);
        expect((await submitTo(form.id, versionId, { grade: 4, medicalCertificate: 'MC-1' })).statusCode).toBe(201);
    });

    it('stores what the formulas give, not the computed values a client sends', async () => {
        const form = await createForm(as.bureau(), 'rules-recompute', {
            fields: [
                text('lines', { type: 'FormArray', props: {}, layout: { options: { isContainer: true } } }),
                num('amount', { parentId: 'lines' }),
                num('lineTotal', {
                    parentId: 'lines',
                    data: { defaultProps: {}, computed: { expression: '{{= row.amount * 2 }}', readOnly: true } }
                }),
                num('total', {
                    data: {
                        defaultProps: {},
                        computed: { expression: "{{= sum(root.lines, 'lineTotal') }}", readOnly: true }
                    }
                })
            ]
        });
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        // a forged line total and a forged grand total
        const res = await submitTo(form.id, versionId, {
            lines: [
                { amount: 100, lineTotal: 1 },
                { amount: 50, lineTotal: 999 }
            ],
            total: 7
        });
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json<SubmissionOut>().answers).toEqual({
            lines: [
                { amount: 100, lineTotal: 200 },
                { amount: 50, lineTotal: 100 }
            ],
            total: 300
        });
    });

    it('takes a day picked on the Ethiopian calendar as the Gregorian date, and exports it in both calendars', async () => {
        const form = await createForm(as.bureau(), 'rules-ethdate', {
            fields: [
                text('issued', {
                    type: 'EthDate',
                    label: { am: 'የተሰጠበት ቀን', en: 'Issued on' },
                    props: { minDate: '2020-01-01' },
                    behavior: { validation: { supported: true } }
                })
            ]
        });
        const versionId = (await publish(form.id, as.bureau(), as.bureau2())).formVersion.id;
        // Meskerem 1, 2019 E.C.
        const filed = await submitTo(form.id, versionId, { issued: '2026-09-11' });
        expect(filed.statusCode, filed.body).toBe(201);
        const id = filed.json<SubmissionOut>().id;
        expect((await get<SubmissionOut>(`/api/v1/submissions/${id}`, as.damot())).answers).toEqual({
            issued: '2026-09-11'
        });
        // a day that does not exist, and one before the earliest allowed, are refused
        expect((await submitTo(form.id, versionId, { issued: '2026-02-30' })).statusCode).toBe(422);
        expect((await submitTo(form.id, versionId, { issued: '2019-12-31' })).statusCode).toBe(422);

        const exported = await call(
            'POST',
            '/api/v1/submissions/export',
            as.zoneHead(),
            { formId: form.id, fields: ['issued'] },
            { 'accept-language': 'en' }
        );
        expect(exported.statusCode, exported.body).toBe(200);
        const [header, row] = exported.rawPayload
            .toString('utf8')
            .replace(/^\uFEFF/, '')
            .trim()
            .split(/\r?\n/);
        expect(header).toBe('"Issued on (E.C.)","Issued on (G.C.)"');
        expect(row).toBe('"01/01/2019","2026-09-11"');
    });

    it('refuses a rule formula the server cannot evaluate when the form is saved', async () => {
        const res = await call('POST', '/api/v1/forms', as.bureau(), {
            key: 'rules-bad-formula',
            name: { am: 'ቅጽ', en: 'Form' },
            document: {
                fields: [
                    num('grade'),
                    text('note', {
                        behavior: {
                            validation: { supported: true, requiredWhen: { expression: 'data.users.length > 0' } }
                        }
                    })
                ]
            }
        });
        expect(res.statusCode, res.body).toBe(422);
        expect(res.json<Problem>().errors.map((e) => e.path)).toContain(
            'document.fields[1].behavior.validation.requiredWhen.expression'
        );
    });
});
