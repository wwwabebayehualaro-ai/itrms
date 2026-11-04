/**
 * What a document's QR carries, and what the public page is told (ADR-0045, task 0.23b). Isomorphic: the PDF worker signs this,
 * and the verifier checks it with no network. The QR is a URL: `https://verify.<domain>/<token>#<payload>.<signature>`. Online,
 * the token asks the API for revocation and superseded status; the part after `#` never leaves the phone, and carries what
 * proves the document offline. Only the token's hash is stored, so the database can't print a valid QR.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** 128 random bits, base64url. */
export const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The signed facts, short because a QR on a licence card has little room. */
export const verificationPayloadSchema = z.object({
    /** format */
    v: z.literal(1),
    /** the signing key's id */
    k: z.string().min(1),
    /** the template's key */
    t: z.string().min(1),
    /** its number, if it carries one */
    n: z.string().nullable(),
    /** the issuing office's code */
    o: z.string(),
    /** issued on */
    i: z.iso.date(),
    /** valid until, if it ends */
    u: z.iso.date().nullable(),
    /** the holder's name hashed (holderHash): a checker with the document in hand compares; the QR tells no name */
    h: z.string().nullable()
});
export type VerificationPayload = z.infer<typeof verificationPayloadSchema>;

const base64UrlOf = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const bytesOfBase64Url = (text: string): Uint8Array =>
    Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

/** The exact bytes that are signed, and the text the QR carries for them. */
export const payloadBytes = (payload: VerificationPayload): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(payload));

export const encodeBase64Url = base64UrlOf;
export const decodeBase64Url = bytesOfBase64Url;

/** The QR's whole text. */
export const verificationUrl = (base: string, token: string, payload: Uint8Array, signature: Uint8Array): string =>
    `${base.replace(/\/+$/, '')}/${token}#${base64UrlOf(payload)}.${base64UrlOf(signature)}`;

/** What the public page shows: a checker's minimum, and a masked name. */
export const VERIFICATION_STATUSES = ['valid', 'expired', 'revoked', 'superseded'] as const;
export const verificationOutSchema = z.object({
    status: z.enum(VERIFICATION_STATUSES),
    documentName: i18nTextSchema,
    number: z.string().nullable(),
    office: i18nTextSchema,
    issuedOn: z.iso.date(),
    validUntil: z.iso.date().nullable(),
    holder: z.string().nullable()
});
export type VerificationOut = z.infer<typeof verificationOutSchema>;
