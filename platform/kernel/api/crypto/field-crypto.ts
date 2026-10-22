/**
 * Field encryption and blind indexes (security.md §10–11, SEC-PD-1, SEC-CR-1): the only code that calls the cipher for
 * sensitive personal fields. Slices call `encrypt`, `decrypt` and `blindIndex`; nothing else touches a key.
 *
 *   - AES-256-GCM envelope encryption: a value is encrypted with its region's data key, which is stored wrapped by a
 *     key-encryption key from `FIELD_KEYS` (outside the database). The ciphertext names its data key, so a rotation leaves
 *     older values readable. The additional data binds a value to its place (`<table>.<column>:<row id>`): a ciphertext
 *     copied to another row or column does not decrypt.
 *   - HMAC-SHA-256 blind indexes with a separate key (`BLIND_INDEX_KEY`): exact-match search and duplicate checks on a
 *     value nobody can read back. The region is part of the input, so two regions' indexes of one value differ.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { newId } from '../db/columns';
import type { Tx } from '../db/types';
import { AppError } from '../errors/app-error';
import { regionDataKeys } from './crypto.table';

const VERSION = 1;
const IV = 12;
const TAG = 16;
const ID = 16;

/** 503: the installation has no keys for sensitive fields (FIELD_KEYS, BLIND_INDEX_KEY). */
export class CryptoUnavailableError extends AppError {
    readonly status = 503;
    constructor() {
        super('unavailable');
    }
}

export interface FieldCryptoKeys {
    /** `id:base64,id:base64` (32-byte keys); the first wraps new data keys, the others still unwrap theirs */
    fieldKeys?: string;
    blindIndexKey?: string;
}

/** Parses `FIELD_KEYS`; the config schema checks the same before a process starts. */
export function parseFieldKeys(value: string): Map<string, Buffer> {
    const keys = new Map<string, Buffer>();
    for (const entry of value
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)) {
        const [id = '', material = ''] = entry.split(':');
        const key = Buffer.from(material, 'base64');
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32 || keys.has(id))
            throw new Error('FIELD_KEYS: expected id:base64 entries of 32-byte keys, each id once');
        keys.set(id, key);
    }
    if (keys.size === 0) throw new Error('FIELD_KEYS: no key');
    return keys;
}

const uuidBytes = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex');
const uuidOf = (bytes: Buffer) => {
    const h = bytes.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function seal(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
    const iv = randomBytes(IV);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
}

const wrapAad = (regionId: string, keyId: string) => Buffer.from(`itrms-dek:${regionId}:${keyId}`);

export class FieldCrypto {
    private readonly keks?: Map<string, Buffer>;
    private readonly currentKek?: string;
    private readonly indexKey?: Buffer;
    /** unwrapped data keys by region and id: a data key is unwrapped once per process, and serves its region only */
    private readonly dataKeys = new Map<string, Buffer>();

    constructor(keys: FieldCryptoKeys = {}) {
        if (keys.fieldKeys) {
            this.keks = parseFieldKeys(keys.fieldKeys);
            this.currentKek = [...this.keks.keys()][0];
        }
        if (keys.blindIndexKey) this.indexKey = Buffer.from(keys.blindIndexKey, 'utf8');
    }

    get available(): boolean {
        return this.keks !== undefined && this.indexKey !== undefined;
    }

    /** `value` encrypted with the region's data key, bound to `place` (`<table>.<column>:<row id>`). */
    async encrypt(tx: Tx, regionId: string, place: string, value: string): Promise<Buffer> {
        const keyId = await this.activeKeyOf(tx, regionId);
        const key = await this.dataKey(tx, regionId, keyId);
        return Buffer.concat([
            Buffer.from([VERSION]),
            uuidBytes(keyId),
            seal(key, Buffer.from(value, 'utf8'), Buffer.from(place))
        ]);
    }

    /** The value `encrypt` gave for the same region and place; throws on any other ciphertext. */
    async decrypt(tx: Tx, regionId: string, place: string, ciphertext: Buffer): Promise<string> {
        if (ciphertext[0] !== VERSION) throw new Error('decrypt: unknown ciphertext version');
        const keyId = uuidOf(ciphertext.subarray(1, 1 + ID));
        const key = await this.dataKey(tx, regionId, keyId);
        return open(key, ciphertext.subarray(1 + ID), Buffer.from(place)).toString('utf8');
    }

    /** The blind index of a normalised value of a kind (`fin`, `phone`): equal values, equal indexes, nothing else. */
    blindIndex(regionId: string, kind: string, normalised: string): Buffer {
        if (!this.indexKey) throw new CryptoUnavailableError();
        return createHmac('sha256', this.indexKey).update(`${kind}\u0000${regionId}\u0000${normalised}`).digest();
    }

    private requireKeks(): Map<string, Buffer> {
        if (!this.keks || !this.currentKek) throw new CryptoUnavailableError();
        return this.keks;
    }

    /**
     * The region's active data key: the stored one, or a new one stored by kernel.ensure_region_data_key. Asked each time,
     * never cached: a key created in a transaction that then rolls back must not be used afterwards.
     */
    private async activeKeyOf(tx: Tx, regionId: string): Promise<string> {
        const keks = this.requireKeks();
        const kekId = this.currentKek as string;
        const candidateId = newId();
        const candidate = randomBytes(32);
        const wrapped = seal(keks.get(kekId) as Buffer, candidate, wrapAad(regionId, candidateId));
        const result = await tx.execute<{ id: string }>(
            sql`select kernel.ensure_region_data_key(${candidateId}::uuid, ${kekId}, ${wrapped}) as id`
        );
        const id = result.rows[0]?.id;
        if (!id) throw new Error('ensure_region_data_key: no key');
        return id;
    }

    private async dataKey(tx: Tx, regionId: string, keyId: string): Promise<Buffer> {
        const keks = this.requireKeks();
        const cached = this.dataKeys.get(`${regionId}:${keyId}`);
        if (cached) return cached;
        // under RLS: only a key of the caller's region is found
        const [row] = await tx
            .select({ regionId: regionDataKeys.regionId, kekId: regionDataKeys.kekId, wrapped: regionDataKeys.wrapped })
            .from(regionDataKeys)
            .where(eq(regionDataKeys.id, keyId));
        const kek = row && keks.get(row.kekId);
        if (!row || row.regionId !== regionId || !kek) throw new Error('decrypt: data key not available');
        const key = open(kek, row.wrapped, wrapAad(regionId, keyId));
        this.dataKeys.set(`${regionId}:${keyId}`, key);
        return key;
    }
}
