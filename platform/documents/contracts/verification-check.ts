/**
 * The offline check of a document's QR (ADR-0046, task 0.23c): needs no network, only the published keys. It carries no validation
 * library, so a cheap phone downloads little; `isVerificationPayload` is held to the contract's schema by a test.
 *
 * A failure of the check itself, such as a browser with no `crypto.subtle`, is thrown and never called forged: that verdict is about
 * the document, and telling an officer a real document is fake because of the phone would be the worst answer this can give.
 */
import { verifyAsync } from '@noble/ed25519';

import type { VerificationPayload } from './verification';
import { decodeBase64Url, encodeBase64Url, signedBytes } from './verification-encoding';

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
/** 32 bytes and 64 bytes, as base64url without padding */
export const PUBLIC_KEY_TEXT = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_TEXT = /^[A-Za-z0-9_-]{86}$/;

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
    // not URL.canParse: the older phones this is for don't have it
    let url: URL;
    try {
        url = new URL(text.trim());
    } catch {
        return null;
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
};

const factsOf = (encoded: string): { bytes: Uint8Array<ArrayBuffer>; facts: VerificationPayload } | null => {
    try {
        const bytes = decodeBase64Url(encoded);
        const facts: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        return isVerificationPayload(facts) ? { bytes, facts } : null;
    } catch (error) {
        // text that isn't base64, UTF-8 or JSON is no proof; anything else is not about the text
        if (error instanceof SyntaxError || error instanceof TypeError || error instanceof DOMException) return null;
        throw error;
    }
};

/**
 * What a scanned text proves. The address in it is read and never opened: a fake QR's own page is what this check is against. RFC
 * 8032's strict rules apply, as the signer's: one document has one valid signature.
 */
export async function checkQr(text: string, keys: readonly PublishedKey[], today: string): Promise<QrCheck> {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, with no nested repetition: linear, and on the phone that scanned it
    const url = addressOf(text);
    const token = url && TOKEN_PATH.exec(url.pathname)?.[1];
    if (!url || !token) return { state: 'notOurs' };
    const proof = PROOF.exec(url.hash.slice(1));
    const read = proof?.[1] ? factsOf(proof[1]) : null;
    if (!proof?.[2] || !read) return { state: 'forged', token };
    const { bytes, facts } = read;
    const key = keys.find((k) => k.keyId === facts.k);
    if (!key) return { state: 'unknownKey', token };
    if (!SIGNATURE_TEXT.test(proof[2]) || !PUBLIC_KEY_TEXT.test(key.publicKey)) return { state: 'forged', token };
    const signature = decodeBase64Url(proof[2]);
    // the last character has spare bits: another spelling of the same signature is still not the one that was printed
    if (encodeBase64Url(signature) !== proof[2]) return { state: 'forged', token };
    const good = await verifyAsync(signature, signedBytes(token, bytes), decodeBase64Url(key.publicKey), {
        zip215: false
    });
    if (!good) return { state: 'forged', token };
    // a retired key signs nothing new: only someone who stole it could date a document after that
    if (key.retiredOn && facts.i > key.retiredOn) return { state: 'forged', token };
    return { state: 'genuine', token, facts, expired: facts.u !== null && facts.u < today };
}

/** Today in Ethiopia: a validity's last day ends there, wherever the phone is set. */
export const addisToday = (now = new Date()): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(now);
