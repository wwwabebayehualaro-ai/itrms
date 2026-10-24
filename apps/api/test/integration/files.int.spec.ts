/**
 * Uploaded files (task 0.15) over HTTP, on a real PostgreSQL 16 and the dev stack's SeaweedFS (bucket itrms-test): the
 * browser's part is played with fetch on the presigned URLs. A file uploaded in Damot Gale is not downloadable from Boditi
 * (a sibling) but is from the zone; a type its bytes do not show is refused; S3 itself refuses more bytes than declared; a
 * large file goes in signed parts; the purge expires what was never confirmed. Needs: pnpm dev:infra.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { Module, type DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { S3ObjectStore } from '@itrms/integrations/api';
import { createHttpApp, createLogger, KernelModule, loadSlices } from '@itrms/kernel/api';
import { purgeExpiredUploads } from '@itrms/kernel/api/worker';
import { loadConfig } from '@itrms/kernel/config';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase } from '@itrms/kernel/db/system';
import { linkFile } from '@itrms/kernel/files';
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
const ISSUER = 'http://keycloak.test/realms/itrms';
const AUDIENCE = 'itrms-api';
const SUB = {
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    boditiRecords: '0199f0a0-d000-7000-8000-000000000302',
    zoneHead: '0199f0a0-d000-7000-8000-000000000101'
};

const envFile = join(HERE, '..', '..', '..', '..', 'infra', 'compose', '.env');
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const S3 = {
    endpoint: process.env.S3_ENDPOINT ?? `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`,
    bucket: process.env.S3_BUCKET ?? 'itrms-test',
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? ''
};

let pg: TestPostgres;
let owner: Client;
let installer: Database;
let app: Database;
let store: S3ObjectStore;
let http: NestFastifyApplication;
let sign: (sub: string) => Promise<string>;
const units = {} as Record<'damot' | 'boditi' | 'zone', OrgUnit>;

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
    if (!S3.accessKeyId || !S3.secretAccessKey) throw new Error('S3 credentials missing: run pnpm dev:infra first');
    pg = await startPostgres();
    installer = createDatabase(pg.url('owner'));
    owner = new Client({ connectionString: pg.url('owner') });
    await owner.connect();
    await installer.scoped({}, (tx) =>
        importOrg(tx, parseOrgYaml(readFileSync(join(SEEDS, 'org', 'south-ethiopia.wolaita.yaml'), 'utf8')))
    );
    const demo = userImportSchema.parse(parseYaml(readFileSync(join(SEEDS, 'users', 'wolaita.demo.yaml'), 'utf8')));
    await installer.scoped({}, (tx) => importUsers(tx, demo));
    units.damot = await unitAt('WOL-DAMOT-GALE');
    units.boditi = await unitAt('WOL-BODITI');
    units.zone = await unitAt('WOL');

    const realm = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
    sign = (sub) =>
        new SignJWT({ sub, iss: ISSUER, aud: AUDIENCE, typ: 'Bearer', azp: 'itrms-web' })
            .setProtectedHeader({ alg: 'RS256', kid: 'realm-key' })
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(realm.privateKey);

    const config = loadConfig('http', { DATABASE_URL: pg.url('app'), AUDIT_HMAC_KEY: randomBytes(32).toString('hex') });
    const logger = createLogger(config, new Writable({ write: (_c, _e, done) => done() }));
    app = createDatabase(config.DATABASE_URL);
    store = new S3ObjectStore({ ...S3 });
    const installed = loadSlices(SLICES);
    @Module({})
    class Root {
        static forRoot(): DynamicModule {
            return {
                module: Root,
                imports: [
                    KernelModule.forRoot(config, logger, {
                        database: app,
                        objectStore: store,
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
    store?.destroy();
    await installer?.close();
    await owner?.end();
    await pg?.stop();
});

async function call(
    method: 'GET' | 'POST',
    url: string,
    as: { sub: string; unit: OrgUnit },
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
                authorization: `Bearer ${await sign(as.sub)}`,
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
const zone = () => ({ sub: SUB.zoneHead, unit: units.zone });

/** A generated PDF-looking file: the PDF signature, then random bytes. */
const pdf = (size: number) => {
    const bytes = randomBytes(size);
    Buffer.from('%PDF-1.7\n').copy(bytes);
    return bytes;
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Ticket {
    file: { id: string; status: string };
    upload:
        | { kind: 'post'; url: string; fields: Record<string, string> }
        | { kind: 'parts'; parts: { partNumber: number; size: number; url: string }[] };
}

/** Asks for an upload of `declared` and sends `bytes` the way the browser does (one POST with the policy's fields). */
async function upload(
    bytes: Buffer,
    declared: { contentType?: string; size?: number; sha256?: string; filename?: string } = {}
): Promise<{ ticket: Ticket; sent: Response }> {
    const begun = await call('POST', '/api/v1/files', damot(), {
        filename: declared.filename ?? 'ፋይል.pdf',
        contentType: declared.contentType ?? 'application/pdf',
        size: declared.size ?? bytes.length,
        sha256: declared.sha256 ?? sha256(bytes),
        documentType: 'id_card'
    });
    expect(begun.statusCode, begun.body).toBe(201);
    const ticket = begun.json<Ticket>();
    if (ticket.upload.kind !== 'post') throw new Error('expected a POST upload');
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.upload.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: declared.contentType ?? 'application/pdf' }));
    return { ticket, sent: await fetch(ticket.upload.url, { method: 'POST', body: form }) };
}

const confirm = (id: string, body: object = {}) => call('POST', `/api/v1/files/${id}/confirm`, damot(), body);

describe('an upload confirmed in Damot Gale', () => {
    const bytes = pdf(4096);
    let id: string;

    beforeAll(async () => {
        const { ticket, sent } = await upload(bytes);
        expect(sent.status).toBe(204);
        id = ticket.file.id;
        const confirmed = await confirm(id);
        expect(confirmed.statusCode, confirmed.body).toBe(200);
        expect(confirmed.json()).toMatchObject({ status: 'stored', size: 4096, documentType: 'id_card' });
    });

    it('is downloaded by its office and the zone above it, with the same bytes and its name', async () => {
        for (const as of [damot(), zone()]) {
            const link = await call('GET', `/api/v1/files/${id}/download`, as);
            expect(link.statusCode).toBe(200);
            const got = await fetch(link.json<{ url: string }>().url);
            expect(got.status).toBe(200);
            expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
            expect(got.headers.get('content-disposition')).toContain(
                `filename*=UTF-8''${encodeURIComponent('ፋይል.pdf')}`
            );
        }
        const { rows } = await owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.audit_log where event_type = 'file.downloaded' and row_id = $1",
            [id]
        );
        expect(rows[0]).toEqual({ n: 2 });
    });

    it('cannot be read or downloaded by a sibling office', async () => {
        expect((await call('GET', `/api/v1/files/${id}`, boditi())).statusCode).toBe(404);
        expect((await call('GET', `/api/v1/files/${id}/download`, boditi())).statusCode).toBe(404);
        // nor confirmed by anyone but who uploaded it
        expect((await call('POST', `/api/v1/files/${id}/confirm`, zone(), {})).statusCode).toBe(403);
    });

    it('is out of quarantine, and links to one record only', async () => {
        const keys = await owner.query<{ object_key: string }>('select object_key from kernel.files where id = $1', [
            id
        ]);
        expect(keys.rows[0]?.object_key).toMatch(/^files\//);
        const record = { table: 'parties.persons', id: randomUUID() };
        const linked = await asUnit(app, units.damot, (tx) => linkFile(tx, id, { ...record, documentType: 'photo' }));
        expect(linked).toMatchObject({ linked: true, documentType: 'photo' });
        await expect(
            asUnit(app, units.damot, (tx) => linkFile(tx, id, { table: 'parties.persons', id: randomUUID() }))
        ).rejects.toMatchObject({ code: 'invalid_transition' });
        // a sibling office cannot even find it to link
        await expect(asUnit(app, units.boditi, (tx) => linkFile(tx, id, record))).rejects.toMatchObject({
            code: 'not_found'
        });
    });
});

describe('a refused upload', () => {
    it('is a type its bytes do not show: refused on confirmation, its object removed', async () => {
        const bytes = pdf(2048);
        // declared and sent as a PNG (the policy's type), but the bytes are a PDF's
        const { ticket, sent } = await upload(bytes, { contentType: 'image/png', filename: 'photo.png' });
        expect(sent.status).toBe(204);
        const refused = await confirm(ticket.file.id);
        expect(refused.statusCode).toBe(422);
        expect(refused.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe('type_mismatch');
        const { rows } = await owner.query<{ status: string; object_key: string }>(
            'select status, object_key from kernel.files where id = $1',
            [ticket.file.id]
        );
        expect(rows[0]?.status).toBe('rejected');
        expect(await store.head(rows[0]?.object_key ?? '')).toBeUndefined();
        // nor its checked copy
        expect(await store.head(`files/${units.damot.regionId}/${ticket.file.id}`)).toBeUndefined();
    });

    it('is a file larger than declared: S3 itself refuses it and stores nothing', async () => {
        const bytes = pdf(2048);
        const { ticket, sent } = await upload(bytes, { size: 1024 });
        expect(sent.status).toBe(400);
        expect(await sent.text()).toContain('EntityTooLarge');
        expect((await confirm(ticket.file.id)).statusCode).toBe(409);
    });

    it('is a type other than the one the policy names: S3 refuses it', async () => {
        const begun = await call('POST', '/api/v1/files', damot(), {
            filename: 'scan.pdf',
            contentType: 'application/pdf',
            size: 100,
            sha256: sha256(pdf(100))
        });
        const ticket = begun.json<Ticket>();
        if (ticket.upload.kind !== 'post') throw new Error('expected a POST upload');
        const form = new FormData();
        for (const [k, v] of Object.entries(ticket.upload.fields))
            form.append(k, k === 'Content-Type' ? 'text/html' : v);
        form.append('file', new Blob([new Uint8Array(pdf(100))], { type: 'text/html' }));
        expect((await fetch(ticket.upload.url, { method: 'POST', body: form })).status).toBe(403);
    });

    it('is a file other than the one declared (its checksum differs)', async () => {
        const bytes = pdf(1024);
        const { ticket, sent } = await upload(bytes, { sha256: sha256(pdf(1024)) });
        expect(sent.status).toBe(204);
        const refused = await confirm(ticket.file.id);
        expect(refused.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe('checksum_mismatch');
    });

    it('is anything not a scan or a photo, before any URL is given', async () => {
        const res = await call('POST', '/api/v1/files', damot(), {
            filename: 'run.exe',
            contentType: 'application/x-msdownload',
            size: 10,
            sha256: sha256(Buffer.from('x'))
        });
        expect(res.statusCode).toBe(422);
    });
});

describe('a large upload', () => {
    it('goes in parts, each URL accepting exactly its signed size, and is assembled on confirmation', async () => {
        const bytes = pdf(17 * 1024 * 1024);
        const begun = await call('POST', '/api/v1/files', damot(), {
            filename: 'large.pdf',
            contentType: 'application/pdf',
            size: bytes.length,
            sha256: sha256(bytes)
        });
        expect(begun.statusCode, begun.body).toBe(201);
        const ticket = begun.json<Ticket>();
        if (ticket.upload.kind !== 'parts') throw new Error('expected parts');
        expect(ticket.upload.parts.map((p) => p.size)).toEqual([8388608, 8388608, 1048576]);
        // more bytes than the part's signed size: refused
        const first = ticket.upload.parts[0];
        if (!first) throw new Error('no part');
        const tooMuch = await fetch(first.url, { method: 'PUT', body: new Uint8Array(first.size + 1) });
        expect(tooMuch.ok).toBe(false);
        const parts: { partNumber: number; etag: string }[] = [];
        let offset = 0;
        for (const part of ticket.upload.parts) {
            const res = await fetch(part.url, {
                method: 'PUT',
                body: new Uint8Array(bytes.subarray(offset, offset + part.size))
            });
            expect(res.status).toBe(200);
            parts.push({ partNumber: part.partNumber, etag: res.headers.get('etag') ?? '' });
            offset += part.size;
        }
        const confirmed = await confirm(ticket.file.id, { parts });
        expect(confirmed.statusCode, confirmed.body).toBe(200);
        expect(confirmed.json()).toMatchObject({ status: 'stored', size: bytes.length });
    });
});

describe('what the review asked of uploads (task 0.15)', () => {
    /** A PNG's signature, then random bytes. */
    const png = (size: number) => {
        const bytes = randomBytes(size);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
        return bytes;
    };

    it('keeps what was checked: posting other bytes to the quarantine key after confirming changes nothing', async () => {
        const bytes = pdf(2048);
        const { ticket } = await upload(bytes);
        expect((await confirm(ticket.file.id)).statusCode).toBe(200);
        if (ticket.upload.kind !== 'post') throw new Error('expected a POST upload');
        // the POST policy is still valid for a few minutes: an attacker re-posts to the same key
        const form = new FormData();
        for (const [k, v] of Object.entries(ticket.upload.fields)) form.append(k, v);
        form.append('file', new Blob([new Uint8Array(pdf(2048))], { type: 'application/pdf' }));
        expect((await fetch(ticket.upload.url, { method: 'POST', body: form })).status).toBe(204);
        const link = (await call('GET', `/api/v1/files/${ticket.file.id}/download`, damot())).json<{ url: string }>();
        expect(Buffer.from(await (await fetch(link.url)).arrayBuffer()).equals(bytes)).toBe(true);
    });

    it('offers a download under the extension of what the bytes are, and refuses names that disguise one', async () => {
        const bytes = png(512);
        const { ticket } = await upload(bytes, { contentType: 'image/png', filename: 'photo.html' });
        expect((await confirm(ticket.file.id)).statusCode).toBe(200);
        const link = (await call('GET', `/api/v1/files/${ticket.file.id}/download`, damot())).json<{ url: string }>();
        const got = await fetch(link.url);
        expect(got.headers.get('content-disposition')).toContain('filename="photo.png"');
        for (const filename of ['scan\u202Efdp.exe', 'a\u200Bb.pdf', 'bad\u0085.pdf', 'a\\b.pdf'])
            expect(
                (
                    await call('POST', '/api/v1/files', damot(), {
                        filename,
                        contentType: 'application/pdf',
                        size: 10,
                        sha256: sha256(pdf(10))
                    })
                ).statusCode,
                JSON.stringify(filename)
            ).toBe(422);
    });

    it("answers wrong parts as the client's mistake, and an overdue upload as expired", async () => {
        const big = pdf(17 * 1024 * 1024);
        const begun = (
            await call('POST', '/api/v1/files', damot(), {
                filename: 'parts.pdf',
                contentType: 'application/pdf',
                size: big.length,
                sha256: sha256(big)
            })
        ).json<Ticket>();
        const wrong = await confirm(begun.file.id, { parts: [{ partNumber: 1, etag: '"nope"' }] });
        expect(wrong.statusCode).toBe(422);

        const { ticket, sent } = await upload(pdf(300));
        expect(sent.status).toBe(204);
        await owner.query("update kernel.files set expires_at = now() - interval '1 minute' where id = $1", [
            ticket.file.id
        ]);
        expect((await confirm(ticket.file.id)).statusCode).toBe(409);
    });

    it('removes a stored file no record linked within a week, and a quarantine leftover after a day', async () => {
        const kept = await upload(pdf(700));
        const unlinked = await upload(pdf(800));
        for (const { ticket } of [kept, unlinked]) expect((await confirm(ticket.file.id)).statusCode).toBe(200);
        await asUnit(app, units.damot, (tx) =>
            linkFile(tx, kept.ticket.file.id, { table: 'parties.persons', id: randomUUID() })
        );
        // a leftover in quarantine that no file owns
        const leftover = `quarantine/${units.damot.regionId}/${randomUUID()}`;
        const post = await store.presignPost({ key: leftover, contentType: 'application/pdf', size: 9, expiresIn: 60 });
        const form = new FormData();
        for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
        form.append('file', new Blob([new TextEncoder().encode('%PDF-1.7\n')], { type: 'application/pdf' }));
        expect((await fetch(post.url, { method: 'POST', body: form })).status).toBe(204);

        const system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
        const errors: unknown[] = [];
        try {
            // eight days on
            await purgeExpiredUploads(system, store, {
                now: Date.now() + 8 * 86_400_000,
                onError: (e) => errors.push(e)
            });
        } finally {
            await system.close();
        }
        expect(errors).toEqual([]);
        const { rows } = await owner.query<{ id: string; status: string }>(
            'select id, status from kernel.files where id = any($1::uuid[])',
            [[kept.ticket.file.id, unlinked.ticket.file.id]]
        );
        expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
            [kept.ticket.file.id]: 'stored',
            [unlinked.ticket.file.id]: 'expired'
        });
        expect(await store.head(`files/${units.damot.regionId}/${unlinked.ticket.file.id}`)).toBeUndefined();
        expect(await store.head(`files/${units.damot.regionId}/${kept.ticket.file.id}`)).toBeDefined();
        expect(await store.head(leftover)).toBeUndefined();
    });
});

describe('what the second review asked (task 0.15)', () => {
    it('confirms an upload once: a second confirmation at the same time never replaces or removes what was checked', async () => {
        const bytes = pdf(4096);
        const { ticket, sent } = await upload(bytes);
        expect(sent.status).toBe(204);
        const answers = await Promise.all([confirm(ticket.file.id), confirm(ticket.file.id)]);
        const codes = answers.map((a) => a.statusCode).sort();
        expect(codes).toContain(200);
        expect(codes.every((c) => c === 200 || c === 409)).toBe(true);

        const link = await call('GET', `/api/v1/files/${ticket.file.id}/download`, damot());
        expect(link.statusCode).toBe(200);
        const got = await fetch(link.json<{ url: string }>().url);
        expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
    });

    it('refuses a confirmation while another one checks the upload', async () => {
        const { ticket } = await upload(pdf(600));
        await owner.query("update kernel.files set status = 'checking' where id = $1", [ticket.file.id]);
        const answer = await confirm(ticket.file.id);
        expect(answer.statusCode).toBe(409);
        expect(answer.json<{ code: string }>().code).toBe('invalid_transition');
    });

    it('never links a file past its week', async () => {
        const { ticket } = await upload(pdf(650));
        expect((await confirm(ticket.file.id)).statusCode).toBe(200);
        await owner.query("update kernel.files set expires_at = now() - interval '1 minute' where id = $1", [
            ticket.file.id
        ]);
        await expect(
            asUnit(app, units.damot, (tx) =>
                linkFile(tx, ticket.file.id, { table: 'parties.persons', id: randomUUID() })
            )
        ).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('leaves a file that a record links while the purge runs, object and all', async () => {
        const { ticket } = await upload(pdf(900));
        expect((await confirm(ticket.file.id)).statusCode).toBe(200);
        await owner.query("update kernel.files set expires_at = now() + interval '1 minute' where id = $1", [
            ticket.file.id
        ]);
        const system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
        const failed: string[] = [];
        let purging: Promise<number> | undefined;
        try {
            await asUnit(app, units.damot, async (tx) => {
                await linkFile(tx, ticket.file.id, { table: 'parties.persons', id: randomUUID() });
                // two minutes on, the purge finds the file unlinked (this link is not committed yet) and waits for its row
                purging = purgeExpiredUploads(system, store, {
                    now: Date.now() + 120_000,
                    onError: (_, what) => failed.push(what)
                });
                await new Promise((resolve) => setTimeout(resolve, 500));
            });
            await purging;
        } finally {
            await system.close();
        }
        expect(failed).toContain(ticket.file.id);
        const { rows } = await owner.query<{ status: string; linked_id: string | null; object_key: string }>(
            'select status, linked_id, object_key from kernel.files where id = $1',
            [ticket.file.id]
        );
        expect(rows[0]?.status).toBe('stored');
        expect(rows[0]?.linked_id).not.toBeNull();
        expect(await store.head(rows[0]?.object_key ?? '')).toBeDefined();
    });
});

describe('the purge', () => {
    it('expires uploads never confirmed after 24 hours, removing their objects and open parts', async () => {
        const { ticket, sent } = await upload(pdf(512));
        expect(sent.status).toBe(204);
        const big = pdf(17 * 1024 * 1024);
        const parts = (
            await call('POST', '/api/v1/files', damot(), {
                filename: 'abandoned.pdf',
                contentType: 'application/pdf',
                size: big.length,
                sha256: sha256(big)
            })
        ).json<Ticket>();
        const fresh = await upload(pdf(256));
        // 25 hours have passed for the first two
        await owner.query("update kernel.files set expires_at = now() - interval '1 hour' where id = any($1::uuid[])", [
            [ticket.file.id, parts.file.id]
        ]);
        const before = await owner.query<{ object_key: string }>('select object_key from kernel.files where id = $1', [
            ticket.file.id
        ]);
        expect(await store.head(before.rows[0]?.object_key ?? '')).toBeDefined();

        const system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
        try {
            expect(await purgeExpiredUploads(system, store)).toBeGreaterThanOrEqual(2);
        } finally {
            await system.close();
        }
        const { rows } = await owner.query<{ id: string; status: string; upload_id: string | null }>(
            'select id, status, upload_id from kernel.files where id = any($1::uuid[]) order by created_at',
            [[ticket.file.id, parts.file.id, fresh.ticket.file.id]]
        );
        expect(rows.map((r) => [r.status, r.upload_id])).toEqual([
            ['expired', null],
            ['expired', null],
            ['pending', null]
        ]);
        expect(await store.head(before.rows[0]?.object_key ?? '')).toBeUndefined();
        const open = await store.listMultipart('quarantine/');
        expect(open.map((u) => u.key)).not.toContain(`quarantine/${units.damot.regionId}/${parts.file.id}`);
        // each expiry is audited
        const audit = await owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.audit_log where table_name = 'kernel.files' and action = 'update' and diff->'after'->>'status' = 'expired'"
        );
        expect(audit.rows[0]?.n).toBeGreaterThanOrEqual(2);
    });

    it('bounds what one person may have waiting', async () => {
        const { rows } = await owner.query<{ n: number }>(
            "select count(*)::int as n from kernel.files where status in ('pending', 'checking') and created_by = (select id from kernel.users where keycloak_sub = $1)",
            [SUB.damotRecords]
        );
        const free = 20 - (rows[0]?.n ?? 0);
        for (let i = 0; i < free; i++)
            expect(
                (
                    await call('POST', '/api/v1/files', damot(), {
                        filename: `q${i}.pdf`,
                        contentType: 'application/pdf',
                        size: 10,
                        sha256: sha256(pdf(10))
                    })
                ).statusCode
            ).toBe(201);
        const over = await call('POST', '/api/v1/files', damot(), {
            filename: 'one-more.pdf',
            contentType: 'application/pdf',
            size: 10,
            sha256: sha256(pdf(10))
        });
        expect(over.statusCode).toBe(429);
    });
});

describe('kernel.files at scale', () => {
    it('finds what the purge removes and what one person has waiting from their indexes (EXPLAIN, under RLS)', async () => {
        // what the table mostly holds: stored files that records link, each by its own uploader
        await owner.query(
            `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key,
                 document_type, linked_table, linked_id, confirmed_at, created_by)
             select g.id, $1, $2, 'stored', 'scan.pdf', 'application/pdf', 1000, repeat('a', 64),
                 'files/' || $3 || '/' || g.id, 'id_card', 'parties.persons', gen_random_uuid(), now(),
                 gen_random_uuid()
             from (select gen_random_uuid() as id from generate_series(1, 5000)) g`,
            [units.damot.regionId, units.damot.id, units.damot.regionId]
        );
        await owner.query('analyze kernel.files');
        const planOf = (rows: Record<string, unknown>[]) => rows.map((r) => String(r['QUERY PLAN'])).join('\n');

        // jobs/files-purge.ts, as the worker runs it
        const system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
        const purge = await system
            .systemContext('files.purge', async (tx) =>
                planOf(
                    (
                        await tx.execute(
                            sql`explain select * from kernel.files where expires_at <= ${new Date()}
                                 and (status in ('pending', 'checking', 'rejected')
                                      or (status = 'stored' and linked_id is null)) limit 500`
                        )
                    ).rows
                )
            )
            .finally(() => system.close());
        process.stdout.write(`EXPLAIN files due for the purge:\n${purge}\n`);
        expect(purge).toContain('files_purge_idx');

        // files.ts beginUpload, as Damot Gale under RLS: one person's waiting files and today's bytes
        const { rows } = await owner.query<{ created_by: string }>(
            "select created_by from kernel.files where filename = 'scan.pdf' and created_by is not null limit 1"
        );
        const person = rows[0]?.created_by ?? '';
        const quota = await asUnit(app, units.damot, async (tx) =>
            planOf(
                (
                    await tx.execute(
                        sql`explain select count(*), sum(size) from kernel.files
                             where created_by = ${person} and status in ('pending', 'checking')`
                    )
                ).rows
            )
        );
        process.stdout.write(`EXPLAIN one person's waiting files under RLS:\n${quota}\n`);
        expect(quota).toContain('files_created_by_idx');
    });
});
