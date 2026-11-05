/**
 * What a document's QR carries, and what the public page is told (ADR-0045, task 0.23b). Isomorphic: the PDF worker signs this,
 * and the verifier checks it with no network. The QR is a URL: `https://verify.<domain>/<token>#<payload>.<signature>`. Online,
 * the token asks the API for revocation and superseded status; the part after `#` never leaves the phone, and carries what
 * proves the document offline. Only the token's hash is stored, so the database can't print a valid QR.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

import { encodeBase64Url } from './verification-encoding';

export { decodeBase64Url, encodeBase64Url, signedBytes } from './verification-encoding';

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
    /** the holder's name masked: a checker compares it with the document in hand. Never a hash: a list of names would undo it */
    h: z.string().nullable()
});
export type VerificationPayload = z.infer<typeof verificationPayloadSchema>;

/** The exact bytes that are signed, and the text the QR carries for them. */
export const payloadBytes = (payload: VerificationPayload): Uint8Array =>
    new TextEncoder().encode(JSON.stringify(payload));

/** The QR's whole text. */
export const verificationUrl = (base: string, token: string, payload: Uint8Array, signature: Uint8Array): string =>
    `${base.replace(/\/+$/, '')}/${token}#${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;

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

/** The public keys the verifier checks a QR with, offline (ADR-0046). A retired key proves only what it signed until that day. */
export const verificationKeysOutSchema = z.object({
    /** the names of the kinds of document: a QR on a licence card has room only for a template's key */
    documents: z.array(z.object({ key: z.string().min(1), name: i18nTextSchema })),
    keys: z.array(
        z.object({
            keyId: z.string().min(1),
            /** the raw 32 bytes, base64url */
            publicKey: z.string().min(1),
            retiredOn: z.iso.date().nullable()
        })
    )
});
export type VerificationKeysOut = z.infer<typeof verificationKeysOutSchema>;
