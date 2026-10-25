/**
 * The object store, as the kernel needs it (architecture §14, ADR-0007, ADR-0020): a port. The S3 adapter
 * (`@itrms/integrations`) implements it and is bound by the process's entry; the kernel never imports an SDK. Every key is
 * the server's (SEC-IN-9); a browser only ever holds a presigned URL for one object, one method, a few minutes.
 */
export interface PresignedPost {
    url: string;
    /** the policy's form fields, sent before the file */
    fields: Record<string, string>;
}

export interface StoredObject {
    size: number;
    contentType?: string;
}

export interface PendingMultipart {
    key: string;
    uploadId: string;
    initiated: Date;
}

export interface ListedObject {
    key: string;
    lastModified: Date;
}

/**
 * The store refused a request because of what the client sent (an unknown part or ETag, an upload already completed or
 * aborted): the kernel answers it as the client's mistake, never as a server error.
 */
export class ObjectStoreRefusal extends Error {
    constructor(
        readonly kind: 'invalid' | 'missing',
        message: string
    ) {
        super(message);
        this.name = 'ObjectStoreRefusal';
    }
}

export interface ObjectStore {
    /** A browser upload of exactly `size` bytes of `contentType`: S3 refuses anything else itself (POST policy). */
    presignPost(o: { key: string; contentType: string; size: number; expiresIn: number }): Promise<PresignedPost>;
    createMultipart(o: { key: string; contentType: string }): Promise<string>;
    /** A part URL that accepts exactly `size` bytes (content-length is signed). */
    presignPart(o: {
        key: string;
        uploadId: string;
        partNumber: number;
        size: number;
        expiresIn: number;
    }): Promise<string>;
    completeMultipart(o: {
        key: string;
        uploadId: string;
        parts: { partNumber: number; etag: string }[];
    }): Promise<void>;
    abortMultipart(key: string, uploadId: string): Promise<void>;
    /** A download, as an attachment with the file's name. */
    presignGet(o: { key: string; filename: string; contentType: string; expiresIn: number }): Promise<string>;
    head(key: string): Promise<StoredObject | undefined>;
    /** Bytes [start, end] of the object (inclusive). */
    readRange(key: string, start: number, end: number): Promise<Uint8Array>;
    /** The SHA-256 of the whole object, hex, streamed. */
    sha256(key: string): Promise<string>;
    copy(from: string, to: string, contentType: string): Promise<void>;
    /** Stores bytes the server made (never a person's upload: those come through presigned URLs). */
    put(o: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
    delete(key: string): Promise<void>;
    /** Multipart uploads begun under a prefix and never completed. */
    listMultipart(prefix: string): Promise<PendingMultipart[]>;
    /** Objects under a prefix, every page. */
    listObjects(prefix: string): Promise<ListedObject[]>;
}

/** No store configured (development without SeaweedFS, the OpenAPI writer): every use fails clearly. */
const none = () => Promise.reject(new Error('This process has no object store (S3_ENDPOINT is not set)'));
export const NO_OBJECT_STORE: ObjectStore = {
    presignPost: none,
    createMultipart: none,
    presignPart: none,
    completeMultipart: none,
    abortMultipart: none,
    presignGet: none,
    head: none,
    readRange: none,
    sha256: none,
    copy: none,
    put: none,
    delete: none,
    listMultipart: none,
    listObjects: none
};
