/**
 * The offline check of a document's QR (ADR-0046, task 0.23c): needs no network, only the published keys. It carries no validation
 * library, so a cheap phone downloads little; `isVerificationPayload` is held to the contract's schema by a test.
 *
 * The signature covers the payload and not the token, so a good signature says the facts are genuine. Whether the token belongs to
 * them is for `sameDocument`, against what the API says of that token.
 */
import { verifyAsync } from '@noble/ed25519';

import type { VerificationOut, VerificationPayload } from './verification';
import { decodeBase64Url } from './verification-encoding';

/** A public key as the API publishes it. A retired key still proves what it signed before it retired. */
export interface PublishedKey {
    keyId: string;
    /** the raw 32 bytes, base64url */
    publicKey: string;
    retiredOn: string | null;
}

export type QrCheck =
    /** not a document's QR at all */
    | { state: 'notOurs' }
    /** a document's QR that fails its proof: altered, forged, or signed by a key after it retired */
    | { state: 'forged'; token: string }
    /** signed by a key this phone doesn't have: newer than its last update, another installation's, or made up */
    | { state: 'unknownKey'; token: string }
    | { state: 'genuine'; token: string; facts: VerificationPayload; expired: boolean };

const TOKEN_PATH = /^\/([A-Za-z0-9_-]{22})\/?$/;
const PROOF = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isTextOrNull = (value: unknown) => value === null || typeof value === 'string';
const isFilledText = (value: unknown) => typeof value === 'string' && value.length > 0;
const isDay = (value: unknown) => typeof value === 'string' && DAY.test(value);

export const isVerificationPayload = (value: unknown): value is VerificationPayload => {
    if (typeof value !== 'object' || value === null) return false;
    const p = value as Record<string, unknown>;
    return (
        p.v === 1 &&
        isFilledText(p.k) &&
        isFilledText(p.t) &&
        isTextOrNull(p.n) &&
        typeof p.o === 'string' &&
        isDay(p.i) &&
        (p.u === null || isDay(p.u)) &&
        isTextOrNull(p.h)
    );
};

const addressOf = (text: string): URL | null => {
    try {
        const url = new URL(text.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
        return null;
    }
};

const factsOf = (encoded: string): { bytes: Uint8Array<ArrayBuffer>; facts: VerificationPayload } | null => {
    try {
        const bytes = decodeBase64Url(encoded);
        const facts: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return isVerificationPayload(facts) ? { bytes, facts } : null;
    } catch {
        return null;
    }
};

const signedBy = async (key: PublishedKey, bytes: Uint8Array, signature: string): Promise<boolean> => {
    try {
        // RFC 8032's strict rules, as the signer's: one document has one valid signature
        return await verifyAsync(decodeBase64Url(signature), bytes, decodeBase64Url(key.publicKey), { zip215: false });
    } catch {
        return false;
    }
};

/** What a scanned text proves. The address in it is read and never opened: a fake QR's own page is what this check is against. */
export async function checkQr(text: string, keys: readonly PublishedKey[], today: string): Promise<QrCheck> {
    const url = addressOf(text);
    const token = url && TOKEN_PATH.exec(url.pathname)?.[1];
    if (!url || !token) return { state: 'notOurs' };
    const proof = PROOF.exec(url.hash.slice(1));
    const read = proof?.[1] ? factsOf(proof[1]) : null;
    if (!proof?.[2] || !read) return { state: 'forged', token };
    const { bytes, facts } = read;
    const key = keys.find((k) => k.keyId === facts.k);
    if (!key) return { state: 'unknownKey', token };
    if (!(await signedBy(key, bytes, proof[2]))) return { state: 'forged', token };
    // a retired key signs nothing new: only someone who stole it could date a document after that
    if (key.retiredOn && facts.i > key.retiredOn) return { state: 'forged', token };
    return { state: 'genuine', token, facts, expired: facts.u !== null && facts.u < today };
}

/** Whether what the API says of the token is the document the signature proves: a real token can be put with another's facts. */
export const sameDocument = (facts: VerificationPayload, document: VerificationOut): boolean =>
    facts.n === document.number &&
    facts.i === document.issuedOn &&
    facts.u === document.validUntil &&
    facts.h === document.holder;

/** Today in Ethiopia: a validity's last day ends there, wherever the phone is set. */
export const addisToday = (now = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(now);
