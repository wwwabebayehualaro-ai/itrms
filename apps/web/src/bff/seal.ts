/**
 * Sealing (AES-256-GCM) for what the BFF keeps: session records in Valkey and the sign-in cookie (ADR-0021, security.md
 * §11). Each sealed value names its key, so keys rotate. The associated data binds a value to where it is stored (a
 * session's id hash, the sign-in cookie), so a value moved elsewhere does not open.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Keyring {
    current: string;
    keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9-]{1,16}$/;

/** `id:base64key[,id:base64key…]`, the first one current; every key is 32 bytes. */
export function parseKeyring(spec: string): Keyring {
    const keys = new Map<string, Buffer>();
    for (const entry of spec
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)) {
        const i = entry.indexOf(':');
        const id = entry.slice(0, i);
        const key = Buffer.from(entry.slice(i + 1), 'base64');
        if (i < 1 || !KEY_ID.test(id)) throw new Error('expected id:base64key entries (ids: a-z, 0-9, -)');
        if (key.length !== 32) throw new Error(`key ${id} is not 32 bytes`);
        if (keys.has(id)) throw new Error(`key ${id} is listed twice`);
        keys.set(id, key);
    }
    const current = keys.keys().next().value;
    if (current === undefined) throw new Error('no key');
    return { current, keys };
}

/** `keyId.iv.ciphertext+tag`, base64url. */
export function seal(keyring: Keyring, plaintext: string, aad: string): string {
    const key = keyring.keys.get(keyring.current);
    if (!key) throw new Error('the current key is missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `${keyring.current}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** The plaintext, or undefined for anything that does not open: tampered, another key, another place, garbage. */
export function open(keyring: Keyring, sealed: string, aad: string): string | undefined {
    const [id, ivText, bodyText, extra] = sealed.split('.');
    const key = id === undefined ? undefined : keyring.keys.get(id);
    if (!key || !ivText || !bodyText || extra !== undefined) return undefined;
    const iv = Buffer.from(ivText, 'base64url');
    const body = Buffer.from(bodyText, 'base64url');
    if (iv.length !== 12 || body.length < 16) return undefined;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(body.subarray(body.length - 16));
        return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
    } catch {
        return undefined;
    }
}
