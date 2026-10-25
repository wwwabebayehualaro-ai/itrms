// S3 contract suite (phase-0 task 0.3): what ITRMS relies on from its object store (architecture §14, ADR-0020, task 0.15).
// It runs against the dev stack's SeaweedFS and is the gate for object-store upgrades: a new version (or another S3
// server) must pass it unchanged. Every refusal test has a positive control, so a test cannot pass for another reason.
// Run: pnpm dev:infra && pnpm test:int        (another server: S3_ENDPOINT=… S3_ACCESS_KEY=… S3_SECRET_KEY=… pnpm test:int)
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CopyObjectCommand,
    CreateMultipartUploadCommand,
    DeleteBucketLifecycleCommand,
    DeleteObjectCommand,
    GetBucketLifecycleConfigurationCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListMultipartUploadsCommand,
    ListObjectsV2Command,
    ListPartsCommand,
    PutBucketLifecycleConfigurationCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const envFile = new URL('../../../../infra/compose/.env', import.meta.url);
if (!process.env.S3_ACCESS_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

const endpoint = process.env.S3_ENDPOINT ?? `http://127.0.0.1:${process.env.S3_HOST_PORT ?? '18333'}`;
const Bucket = process.env.S3_BUCKET ?? 'itrms-test';
const accessKeyId = process.env.S3_ACCESS_KEY ?? '';
const secretAccessKey = process.env.S3_SECRET_KEY ?? '';
const prefix = `contract/${Date.now()}-${randomBytes(4).toString('hex')}/`;

const client = (secret = secretAccessKey) =>
    new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        // The SDK's default checksums would sign a CRC of an empty body into presigned PUT URLs, so every browser upload
        // would fail with BadDigest. The ObjectStore adapter (task 0.15) uses the same setting.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: { accessKeyId, secretAccessKey: secret }
    });
const s3 = client();

const statusOf = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

async function exists(Key: string): Promise<boolean> {
    try {
        await s3.send(new HeadObjectCommand({ Bucket, Key }));
        return true;
    } catch (e) {
        if (statusOf(e) === 404) return false;
        throw e;
    }
}

async function pendingUploads(Prefix: string): Promise<string[]> {
    const listed = await s3.send(new ListMultipartUploadsCommand({ Bucket, Prefix }));
    return (listed.Uploads ?? []).map((u) => u.UploadId ?? '');
}

/** A presigned POST as the browser sends it (architecture §14: small files, size and type conditions). */
async function postUpload(Key: string, size: number, sentType: string, sentKey = Key) {
    const { url, fields } = await createPresignedPost(s3, {
        Bucket,
        Key,
        Conditions: [
            ['content-length-range', 1, 16],
            ['eq', '$Content-Type', 'application/pdf']
        ],
        Fields: { 'Content-Type': 'application/pdf' },
        Expires: 300
    });
    const form = new FormData();
    for (const [k, v] of Object.entries(fields))
        form.append(k, k === 'Content-Type' ? sentType : k === 'key' ? sentKey : v);
    form.append('file', new Blob([new Uint8Array(size)], { type: sentType }));
    return fetch(url, { method: 'POST', body: form });
}

beforeAll(() => {
    if (!accessKeyId || !secretAccessKey) throw new Error('S3 credentials missing: run pnpm dev:infra first');
});

afterAll(async () => {
    // Remove everything under this run's prefix, every page, and abort uploads a failed run left behind.
    let ContinuationToken: string | undefined;
    do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }));
        for (const o of page.Contents ?? []) await s3.send(new DeleteObjectCommand({ Bucket, Key: o.Key }));
        ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
    const pending = await s3.send(new ListMultipartUploadsCommand({ Bucket, Prefix: prefix }));
    for (const u of pending.Uploads ?? []) {
        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: u.Key, UploadId: u.UploadId }));
    }
    s3.destroy();
});

describe('presigned POST: small uploads with size and type conditions (architecture §14, task 0.15)', () => {
    it('accepts a file within the size range and of the declared type', async () => {
        const Key = `${prefix}post/ok.pdf`;
        expect((await postUpload(Key, 10, 'application/pdf')).status).toBe(204);
        expect((await s3.send(new HeadObjectCommand({ Bucket, Key }))).ContentType).toBe('application/pdf');
    });

    it('refuses a file larger than the content-length-range, and stores nothing', async () => {
        const Key = `${prefix}post/too-big.pdf`;
        const res = await postUpload(Key, 32, 'application/pdf');
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('EntityTooLarge');
        expect(await exists(Key)).toBe(false);
    });

    it('refuses a file of another content type, and stores nothing', async () => {
        const Key = `${prefix}post/wrong-type.pdf`;
        expect((await postUpload(Key, 10, 'text/html')).status).toBe(403);
        expect(await exists(Key)).toBe(false);
    });

    it('refuses a form whose key is not the signed one, and stores nothing at either', async () => {
        // one upload ticket must never write another file's key (a stored, checked file of someone else)
        const Key = `${prefix}post/signed.pdf`;
        const other = `${prefix}post/someone-else.pdf`;
        expect((await postUpload(Key, 10, 'application/pdf', other)).status).toBe(403);
        expect(await exists(other)).toBe(false);
        expect(await exists(Key)).toBe(false);
    });
});

describe('presigned PUT and GET', () => {
    it('round-trips the same bytes and content type, with an Ethiopic key and body', async () => {
        const Key = `${prefix}presigned/ሰላም.txt`;
        const body = 'ሰላም ITRMS · Wolaytta: Saro ta’a';
        const put = await getSignedUrl(
            s3,
            new PutObjectCommand({ Bucket, Key, ContentType: 'text/plain; charset=utf-8' }),
            { expiresIn: 300, signableHeaders: new Set(['content-type']) }
        );
        const up = await fetch(put, { method: 'PUT', body, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        expect(up.status).toBe(200);

        const get = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 300 });
        const down = await fetch(get);
        expect(down.status).toBe(200);
        expect(down.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await down.text()).toBe(body);
    });

    it('binds the content type only when it is a signed header (task 0.15 must sign it)', async () => {
        const Key = `${prefix}presigned/typed.pdf`;
        const put = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: 'application/pdf' }), {
            expiresIn: 300,
            signableHeaders: new Set(['content-type'])
        });
        expect((await fetch(put, { method: 'PUT', body: 'x', headers: { 'content-type': 'text/html' } })).status).toBe(
            403
        );
        expect(await exists(Key)).toBe(false);
        // Control: the declared type is accepted with the same URL.
        expect(
            (await fetch(put, { method: 'PUT', body: 'x', headers: { 'content-type': 'application/pdf' } })).status
        ).toBe(200);
    });

    it('refuses a body larger than the signed size, and stores nothing', async () => {
        const Key = `${prefix}presigned/limited.bin`;
        const put = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentLength: 16 }), {
            expiresIn: 300,
            signableHeaders: new Set(['content-length'])
        });
        expect((await fetch(put, { method: 'PUT', body: new Uint8Array(32) })).ok).toBe(false);
        expect(await exists(Key)).toBe(false);
        // Control: the same URL accepts exactly the signed size, so the refusal above was about the size.
        expect((await fetch(put, { method: 'PUT', body: new Uint8Array(16) })).status).toBe(200);
        expect(await exists(Key)).toBe(true);
    });

    it('refuses an expired URL', async () => {
        const Key = `${prefix}presigned/expired.txt`;
        await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'x' }));
        const get = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 2 });
        expect((await fetch(get)).status).toBe(200); // control: valid while unexpired
        await new Promise((r) => setTimeout(r, 3500));
        expect((await fetch(get)).status).toBe(403);
    });

    it('refuses a tampered URL', async () => {
        const Key = `${prefix}presigned/original.txt`;
        await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'original' }));
        await s3.send(new PutObjectCommand({ Bucket, Key: `${prefix}presigned/other.txt`, Body: 'other' }));
        const get = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 300 });
        expect((await fetch(get)).status).toBe(200); // control: the untampered URL works
        expect((await fetch(get.replace('original.txt', 'other.txt'))).status).toBe(403);
    });
});

describe('access control', () => {
    it('refuses wrong credentials', async () => {
        await expect(s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))).resolves.toBeDefined(); // control
        const wrong = client('not-the-secret');
        await expect(wrong.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))).rejects.toMatchObject({
            $metadata: { httpStatusCode: 403 }
        });
        wrong.destroy();
    });

    it('refuses an anonymous read and an anonymous listing', async () => {
        const Key = `${prefix}private.txt`;
        await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'private' }));
        expect((await fetch(`${endpoint}/${Bucket}/${encodeURI(Key)}`)).status).toBe(403);
        expect((await fetch(`${endpoint}/${Bucket}?list-type=2`)).status).toBe(403);
    });
});

describe('multipart uploads (large scans; Uppy part URLs, architecture §14)', () => {
    it('assembles parts into one object', async () => {
        const Key = `${prefix}multipart/scan.bin`;
        const part1 = randomBytes(5 * 1024 * 1024); // S3's minimum size for every part but the last
        const part2 = randomBytes(1234);
        const { UploadId } = await s3.send(
            new CreateMultipartUploadCommand({ Bucket, Key, ContentType: 'application/pdf' })
        );
        const parts = [];
        for (const [i, Body] of [part1, part2].entries()) {
            const { ETag } = await s3.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: i + 1, Body }));
            parts.push({ ETag, PartNumber: i + 1 });
        }
        await s3.send(new CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: parts } }));

        const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        expect(head.ContentLength).toBe(part1.length + part2.length);
        expect(head.ContentType).toBe('application/pdf');
        const { Body } = await s3.send(new GetObjectCommand({ Bucket, Key }));
        if (!Body) throw new Error('GetObject returned no body');
        expect(Buffer.from(await Body.transformToByteArray()).equals(Buffer.concat([part1, part2]))).toBe(true);
    });

    it('a presigned part URL refuses more than its signed size and accepts exactly it', async () => {
        const Key = `${prefix}multipart/bounded.bin`;
        const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key }));
        const url = await getSignedUrl(
            s3,
            new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, ContentLength: 1024 }),
            { expiresIn: 300, signableHeaders: new Set(['content-length']) }
        );
        expect((await fetch(url, { method: 'PUT', body: new Uint8Array(2048) })).status).toBe(403);
        const ok = await fetch(url, { method: 'PUT', body: randomBytes(1024) });
        expect(ok.status).toBe(200);
        await s3.send(
            new CompleteMultipartUploadCommand({
                Bucket,
                Key,
                UploadId,
                MultipartUpload: { Parts: [{ PartNumber: 1, ETag: ok.headers.get('etag') ?? '' }] }
            })
        );
        expect((await s3.send(new HeadObjectCommand({ Bucket, Key }))).ContentLength).toBe(1024);
    });

    it('lists an open upload’s parts with their ETags, even before any part, and answers 404 once it is aborted', async () => {
        // what S3ObjectStore.completeMultipart checks before completing (the stores disagree on completing without parts)
        const Key = `${prefix}multipart/listed.bin`;
        const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key }));
        expect((await s3.send(new ListPartsCommand({ Bucket, Key, UploadId }))).Parts ?? []).toEqual([]);

        const { ETag } = await s3.send(
            new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, Body: randomBytes(1024) })
        );
        const listed = await s3.send(new ListPartsCommand({ Bucket, Key, UploadId }));
        expect(listed.Parts?.map((p) => [p.PartNumber, p.ETag])).toEqual([[1, ETag]]);

        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
        const gone = await s3.send(new ListPartsCommand({ Bucket, Key, UploadId })).catch((e: unknown) => e);
        expect(statusOf(gone)).toBe(404);
    });

    it('an aborted upload is listed before the abort and gone after it', async () => {
        const Key = `${prefix}multipart/aborted.bin`;
        const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key }));
        await s3.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1, Body: randomBytes(1024) }));
        expect(await pendingUploads(Key)).toContain(UploadId); // control: the listing sees it

        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
        expect(await pendingUploads(Key)).not.toContain(UploadId);
        expect(await exists(Key)).toBe(false);
    });
});

describe('promotion, lifecycle, delete and list', () => {
    it('copies an object from quarantine/ to clean/ server-side, keeping its type (scan promotion)', async () => {
        const from = `${prefix}quarantine/scan.pdf`;
        const to = `${prefix}clean/scan.pdf`;
        await s3.send(new PutObjectCommand({ Bucket, Key: from, Body: 'scanned', ContentType: 'application/pdf' }));
        await s3.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${encodeURI(from)}` }));
        await s3.send(new DeleteObjectCommand({ Bucket, Key: from }));

        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: to }));
        expect([head.ContentLength, head.ContentType]).toEqual([7, 'application/pdf']);
        expect(await exists(from)).toBe(false);
    });

    it('stores lifecycle rules for incomplete uploads and quarantine expiry (enforcement: the purge job, task 0.15)', async () => {
        const lifecycleBucket = Bucket;
        await s3.send(
            new PutBucketLifecycleConfigurationCommand({
                Bucket: lifecycleBucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            ID: 'abort-incomplete-uploads',
                            Status: 'Enabled',
                            Filter: { Prefix: '' },
                            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
                        },
                        {
                            ID: 'expire-quarantine',
                            Status: 'Enabled',
                            Filter: { Prefix: 'quarantine/' },
                            Expiration: { Days: 1 }
                        }
                    ]
                }
            })
        );
        try {
            const got = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: lifecycleBucket }));
            const rule = (id: string) => (got.Rules ?? []).find((r) => r.ID === id);
            expect(rule('abort-incomplete-uploads')?.AbortIncompleteMultipartUpload?.DaysAfterInitiation).toBe(1);
            expect(rule('expire-quarantine')?.Expiration?.Days).toBe(1);
        } finally {
            await s3.send(new DeleteBucketLifecycleCommand({ Bucket: lifecycleBucket }));
        }
    });

    it('keeps what the server puts as it was put: bytes, content type and size (S3ObjectStore.put, task 0.16e)', async () => {
        const Key = `${prefix}generated/export.csv`;
        const Body = Buffer.from(['"ስም","Name"', '"ሐና","Hana"', ''].join(String.fromCharCode(13, 10)), 'utf8');
        await s3.send(
            new PutObjectCommand({ Bucket, Key, Body, ContentType: 'text/csv', ContentLength: Body.byteLength })
        );
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        expect(head.ContentType).toBe('text/csv');
        expect(head.ContentLength).toBe(Body.byteLength);
        const got = await s3.send(new GetObjectCommand({ Bucket, Key }));
        expect(Buffer.from((await got.Body?.transformToByteArray()) ?? [])).toEqual(Body);
    });

    it('a deleted object is gone', async () => {
        const Key = `${prefix}delete/me.txt`;
        await s3.send(new PutObjectCommand({ Bucket, Key, Body: 'bye' }));
        expect(await exists(Key)).toBe(true); // control
        await s3.send(new DeleteObjectCommand({ Bucket, Key }));
        expect(await exists(Key)).toBe(false);
    });

    it('lists a prefix page by page, in key order', async () => {
        const keys = ['a', 'b', 'c', 'd', 'e'].map((k) => `${prefix}list/${k}.txt`);
        for (const Key of keys) await s3.send(new PutObjectCommand({ Bucket, Key, Body: Key }));

        const seen: string[] = [];
        let ContinuationToken: string | undefined;
        let pages = 0;
        do {
            const page = await s3.send(
                new ListObjectsV2Command({ Bucket, Prefix: `${prefix}list/`, MaxKeys: 2, ContinuationToken })
            );
            seen.push(...(page.Contents ?? []).map((o) => o.Key ?? ''));
            ContinuationToken = page.NextContinuationToken;
            pages++;
        } while (ContinuationToken);

        expect(seen).toEqual(keys);
        expect(pages).toBe(3);
    });
});
