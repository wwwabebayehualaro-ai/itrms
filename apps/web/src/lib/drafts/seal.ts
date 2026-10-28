/**
 * Sealing a draft for the browser's storage (task 0.20c, SEC-WB-3): AES-GCM with a key that cannot be exported, made per
 * person and kept in IndexedDB as a CryptoKey, so what is stored is unreadable without it, and deleting the key makes it
 * unreadable for good (an explicit sign-out). Each seal has its own random IV.
 */

export interface Sealed {
    iv: Uint8Array<ArrayBuffer>;
    data: ArrayBuffer;
}

/** A new key for one person: AES-GCM 256, not extractable (its bytes never leave the browser's crypto). */
export function newSealKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
    return { iv, data };
}

/** The value sealed with `key`; it throws when the key is another (or the data was changed). */
export async function unseal(key: CryptoKey, sealed: Sealed): Promise<unknown> {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data);
    return JSON.parse(decoder.decode(plain)) as unknown;
}
