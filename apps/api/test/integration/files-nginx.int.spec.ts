/**
 * The /files exposure (task 0.15 "bucket listing through Nginx is denied"), proven on a real Nginx: the /files locations
 * of infra/compose/nginx/itrms.conf.template in front of the dev stack's SeaweedFS. A presigned download and a presigned
 * POST pass; a listing, the bucket, an unsigned object request and any other operation are refused before the store.
 * Needs: pnpm dev:infra (SeaweedFS on the itrms Compose network).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { S3ObjectStore } from '@itrms/integrations/api';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const NGINX_DIR = join(HERE, '..', '..', '..', '..', 'infra', 'compose', 'nginx');
const envFile = join(HERE, '..', '..', '..', '..', 'infra', 'compose', '.env');
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

/** Nginx's stable line (ADR-0008); the production profile pins the same in task 0.26. */
const IMAGE = 'nginx:1.27-alpine';
const NETWORK = process.env.ITRMS_STORAGE_NETWORK ?? 'itrms_storage';
const BUCKET = 'itrms-test';
const credentials = { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' };

/** The template's /files locations, in a server of their own. */
function filesServer(): string {
    const template = readFileSync(join(NGINX_DIR, 'itrms.conf.template'), 'utf8');
    const start = template.indexOf('    # anything under /files');
    const end = template.indexOf('    # everything else is the staff app');
    if (start < 0 || end < start) throw new Error('the /files locations are not in the template');
    return `server {\n    listen 80;\n${template.slice(start, end)}}\n`;
}

let nginx: StartedTestContainer;
let base: string;
/** Signs as the API does: for the store's address on the Compose network, handed out under /files. */
const viaNginx = new S3ObjectStore({
    endpoint: 'http://seaweedfs:8333',
    bucket: BUCKET,
    ...credentials,
    publicPath: '/files'
});
/** The test's own access to the store, to put the object read back. */
const direct = new S3ObjectStore({
    endpoint: `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`,
    bucket: BUCKET,
    ...credentials
});
const key = `quarantine/nginx-test/${randomBytes(8).toString('hex')}`;

beforeAll(async () => {
    if (!credentials.accessKeyId) throw new Error('S3 credentials missing: run pnpm dev:infra first');
    nginx = await new GenericContainer(IMAGE)
        .withNetworkMode(NETWORK)
        .withCopyContentToContainer([
            { content: filesServer(), target: '/etc/nginx/conf.d/default.conf' },
            {
                content: readFileSync(join(NGINX_DIR, 'itrms-s3-proxy.conf'), 'utf8'),
                target: '/etc/nginx/itrms-s3-proxy.conf'
            }
        ])
        .withExposedPorts(80)
        .start();
    base = `http://${nginx.getHost()}:${nginx.getMappedPort(80)}`;
    // a PDF put straight into the store (a presigned POST through Nginx is tested below)
    const post = await direct.presignPost({ key, contentType: 'application/pdf', size: 9, expiresIn: 60 });
    const form = new FormData();
    for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
    form.append('file', new Blob([new TextEncoder().encode('%PDF-1.7\n')], { type: 'application/pdf' }));
    expect((await fetch(post.url, { method: 'POST', body: form })).status).toBe(204);
}, 240_000);

afterAll(async () => {
    await direct.delete(key).catch(() => undefined);
    direct.destroy();
    viaNginx.destroy();
    await nginx?.stop();
});

describe('/files through Nginx', () => {
    it('serves a presigned download, and takes a presigned upload', async () => {
        const url = await viaNginx.presignGet({
            key,
            filename: 'scan.pdf',
            contentType: 'application/pdf',
            expiresIn: 60
        });
        expect(url.startsWith('/files/itrms-test/')).toBe(true);
        const got = await fetch(base + url);
        expect(got.status).toBe(200);
        expect(await got.text()).toBe('%PDF-1.7\n');

        const uploadKey = `${key}-up`;
        const post = await viaNginx.presignPost({
            key: uploadKey,
            contentType: 'application/pdf',
            size: 9,
            expiresIn: 60
        });
        const form = new FormData();
        for (const [k, v] of Object.entries(post.fields)) form.append(k, v);
        form.append('file', new Blob([new TextEncoder().encode('%PDF-1.7\n')], { type: 'application/pdf' }));
        expect((await fetch(base + post.url, { method: 'POST', body: form })).status).toBe(204);
        expect(await direct.head(uploadKey)).toMatchObject({ size: 9 });
        await direct.delete(uploadKey);
    });

    it('refuses a bucket listing, the store root, an unsigned object and any other operation', async () => {
        const refused = [
            ['GET', '/files/'],
            // a path the object locations do not match is refused too, never sent on to the app
            ['GET', '/files/UPPER/x'],
            ['GET', '/files/a_b/x'],
            ['GET', `/files/${BUCKET}`],
            ['GET', `/files/${BUCKET}/`],
            ['GET', `/files/${BUCKET}?list-type=2`],
            ['GET', `/files/${BUCKET}/?list-type=2&prefix=quarantine/`],
            ['GET', `/files/${BUCKET}/${key}`],
            ['POST', `/files/${BUCKET}?delete`],
            ['POST', `/files/${BUCKET}/${key}?uploads`],
            ['DELETE', `/files/${BUCKET}/${key}`],
            ['HEAD', `/files/${BUCKET}`]
        ] as const;
        for (const [method, path] of refused) {
            const res = await fetch(base + path, { method });
            expect(res.status, `${method} ${path}`).toBe(403);
        }
        // a signed URL used for another operation is refused too (a listing with a download's signature)
        const url = await viaNginx.presignGet({
            key,
            filename: 'scan.pdf',
            contentType: 'application/pdf',
            expiresIn: 60
        });
        const query = url.slice(url.indexOf('?'));
        expect((await fetch(`${base}/files/${BUCKET}${query}&list-type=2`)).status).toBe(403);
        expect((await fetch(`${base}/files/${BUCKET}/${key}${query}&uploads`, { method: 'PUT' })).status).toBe(403);
    });
});
