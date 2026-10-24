/**
 * The kernel's ObjectStore on an S3 API (SeaweedFS, ADR-0007, ADR-0020). What it relies on is proven by the S3 contract
 * suite (test/integration/s3.contract.int.spec.ts): POST policies refuse another size or type, signed part URLs refuse
 * another length, server-side copy keeps the type.
 *
 * Browsers reach the store through the app's own origin: `publicPath` (`/files`) replaces the store's origin in every URL
 * handed out, and the proxy in front (Nginx in production, the web app's rewrite in development) forwards `/files/…` to
 * the store as it was signed. No CORS, no other origin in the CSP, and the store is never published by itself.
 */
import { createHash } from 'node:crypto';

import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CopyObjectCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListMultipartUploadsCommand,
    ListObjectsV2Command,
    ListPartsCommand,
    S3Client,
    UploadPartCommand
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
    ObjectStoreRefusal,
    type ListedObject,
    type ObjectStore,
    type PendingMultipart,
    type PresignedPost,
    type StoredObject
} from '@itrms/kernel/files';

export interface S3ObjectStoreOptions {
    endpoint: string;
    region?: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** the path browsers use for the store on the app's origin (`/files`); absent: the store's own URLs */
    publicPath?: string;
}

const statusOf = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

/** An ETag with or without its quotes (stores list them quoted; clients pass on what the part upload answered). */
const unquoted = (etag: string) =>
    etag.length >= 2 && etag.startsWith('"') && etag.endsWith('"') ? etag.slice(1, -1) : etag;

/** RFC 8187: every character outside attr-char is percent-encoded (encodeURIComponent leaves ' ( ) * as they are). */
const rfc8187 = (value: string) =>
    encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** RFC 6266: an ASCII fallback and the UTF-8 name (Ethiopic file names download with their names). */
function disposition(filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc8187(filename)}`;
}

export class S3ObjectStore implements ObjectStore {
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly publicPath?: string;

    constructor(options: S3ObjectStoreOptions) {
        this.bucket = options.bucket;
        this.publicPath = options.publicPath?.replace(/\/$/, '');
        this.s3 = new S3Client({
            endpoint: options.endpoint,
            region: options.region ?? 'us-east-1',
            forcePathStyle: true,
            // the SDK's default checksums would sign a CRC of an empty body into presigned URLs (BadDigest on upload)
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        });
    }

    /** A URL as the browser uses it: on the app's origin under publicPath, the signed path and query unchanged. */
    private public(url: string): string {
        if (!this.publicPath) return url;
        const u = new URL(url);
        return `${this.publicPath}${u.pathname}${u.search}`;
    }

    async presignPost(o: {
        key: string;
        contentType: string;
        size: number;
        expiresIn: number;
    }): Promise<PresignedPost> {
        const { url, fields } = await createPresignedPost(this.s3, {
            Bucket: this.bucket,
            Key: o.key,
            // exactly the declared size and type: S3 refuses anything else and stores nothing
            Conditions: [
                ['content-length-range', o.size, o.size],
                ['eq', '$Content-Type', o.contentType]
            ],
            Fields: { 'Content-Type': o.contentType },
            Expires: o.expiresIn
        });
        return { url: this.public(url), fields };
    }

    async createMultipart(o: { key: string; contentType: string }): Promise<string> {
        const created = await this.s3.send(
            new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: o.key, ContentType: o.contentType })
        );
        if (!created.UploadId) throw new Error('the object store gave no upload id');
        return created.UploadId;
    }

    async presignPart(o: {
        key: string;
        uploadId: string;
        partNumber: number;
        size: number;
        expiresIn: number;
    }): Promise<string> {
        const url = await getSignedUrl(
            this.s3,
            new UploadPartCommand({
                Bucket: this.bucket,
                Key: o.key,
                UploadId: o.uploadId,
                PartNumber: o.partNumber,
                ContentLength: o.size
            }),
            // the length is signed: the part URL accepts exactly this many bytes
            { expiresIn: o.expiresIn, signableHeaders: new Set(['content-length']) }
        );
        return this.public(url);
    }

    async completeMultipart(o: {
        key: string;
        uploadId: string;
        parts: { partNumber: number; etag: string }[];
    }): Promise<void> {
        // Checked against the store's own list first: S3 answers unknown parts with InvalidPart, but SeaweedFS answers an
        // upload without parts with NoSuchUpload, which would read as an upload that is gone
        const uploaded = await this.uploadedParts(o.key, o.uploadId);
        if (!uploaded) throw new ObjectStoreRefusal('missing', 'the upload is no longer open');
        if (o.parts.some((p) => unquoted(uploaded.get(p.partNumber) ?? '') !== unquoted(p.etag) || !p.etag))
            throw new ObjectStoreRefusal('invalid', 'the parts do not match the upload');
        try {
            await this.complete(o);
        } catch (e) {
            // the client's parts or ETags are wrong, or the upload is gone (completed or aborted meanwhile)
            const status = statusOf(e);
            if (status === 404) throw new ObjectStoreRefusal('missing', 'the upload is no longer open');
            if (status !== undefined && status >= 400 && status < 500)
                throw new ObjectStoreRefusal('invalid', 'the parts do not match the upload');
            throw e;
        }
    }

    /** Part number → ETag of what was uploaded, or undefined when the upload is not open (completed or aborted). */
    private async uploadedParts(Key: string, UploadId: string): Promise<Map<number, string> | undefined> {
        const parts = new Map<number, string>();
        let PartNumberMarker: string | undefined;
        try {
            do {
                const page = await this.s3.send(
                    new ListPartsCommand({ Bucket: this.bucket, Key, UploadId, PartNumberMarker })
                );
                for (const p of page.Parts ?? [])
                    if (p.PartNumber !== undefined && p.ETag) parts.set(p.PartNumber, p.ETag);
                PartNumberMarker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
            } while (PartNumberMarker);
        } catch (e) {
            if (statusOf(e) === 404) return undefined;
            throw e;
        }
        return parts;
    }

    private async complete(o: {
        key: string;
        uploadId: string;
        parts: { partNumber: number; etag: string }[];
    }): Promise<void> {
        await this.s3.send(
            new CompleteMultipartUploadCommand({
                Bucket: this.bucket,
                Key: o.key,
                UploadId: o.uploadId,
                MultipartUpload: {
                    Parts: [...o.parts]
                        .sort((a, b) => a.partNumber - b.partNumber)
                        .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }))
                }
            })
        );
    }

    async abortMultipart(key: string, uploadId: string): Promise<void> {
        await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    }

    async presignGet(o: { key: string; filename: string; contentType: string; expiresIn: number }): Promise<string> {
        const url = await getSignedUrl(
            this.s3,
            new GetObjectCommand({
                Bucket: this.bucket,
                Key: o.key,
                ResponseContentDisposition: disposition(o.filename),
                ResponseContentType: o.contentType
            }),
            { expiresIn: o.expiresIn }
        );
        return this.public(url);
    }

    async head(key: string): Promise<StoredObject | undefined> {
        try {
            const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return { size: head.ContentLength ?? 0, contentType: head.ContentType };
        } catch (e) {
            if (statusOf(e) === 404) return undefined;
            throw e;
        }
    }

    async readRange(key: string, start: number, end: number): Promise<Uint8Array> {
        const got = await this.s3.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` })
        );
        return got.Body ? await got.Body.transformToByteArray() : new Uint8Array();
    }

    async sha256(key: string): Promise<string> {
        const got = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        const hash = createHash('sha256');
        const body = got.Body as AsyncIterable<Uint8Array> | undefined;
        if (body) for await (const chunk of body) hash.update(chunk);
        return hash.digest('hex');
    }

    async copy(from: string, to: string, contentType: string): Promise<void> {
        await this.s3.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                Key: to,
                CopySource: `${this.bucket}/${from.split('/').map(encodeURIComponent).join('/')}`,
                ContentType: contentType,
                MetadataDirective: 'REPLACE'
            })
        );
    }

    async delete(key: string): Promise<void> {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    async listMultipart(prefix: string): Promise<PendingMultipart[]> {
        const out: PendingMultipart[] = [];
        let KeyMarker: string | undefined;
        let UploadIdMarker: string | undefined;
        do {
            const page = await this.s3.send(
                new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: prefix, KeyMarker, UploadIdMarker })
            );
            for (const u of page.Uploads ?? [])
                if (u.Key && u.UploadId)
                    out.push({ key: u.Key, uploadId: u.UploadId, initiated: u.Initiated ?? new Date() });
            KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
            UploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
        } while (KeyMarker);
        return out;
    }

    async listObjects(prefix: string): Promise<ListedObject[]> {
        const out: ListedObject[] = [];
        let ContinuationToken: string | undefined;
        do {
            const page = await this.s3.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken })
            );
            for (const o of page.Contents ?? [])
                if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date() });
            ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return out;
    }

    destroy(): void {
        this.s3.destroy();
    }
}
