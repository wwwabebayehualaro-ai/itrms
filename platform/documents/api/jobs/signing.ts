/**
 * The region's signing key and a document's QR (ADR-0045, task 0.23b), in the PDF worker only. Ed25519: a phone can check a
 * signature offline with the published public key. A private key is kept wrapped by the installation's key-encryption key,
 * which is outside the database (SEC-CR-1), and is rotated yearly; a retired key's public half keeps verifying what it signed.
 */
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { actFor, insertAudited, newId, updateAudited, type Tx } from '@itrms/kernel/db';
import type { SystemDatabase } from '@itrms/kernel/db/system';
import type { FieldCrypto } from '@itrms/kernel/crypto';
import { orgUnits } from '@itrms/kernel/tables';
import QRCode from 'qrcode';

import { encodeBase64Url } from '../../contracts';
import { signingKeys } from '../documents.table';

/** How long a key signs before the next takes over. */
export const KEY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface SigningKey {
    id: string;
    keyId: string;
    privateDer: Buffer;
}

const placeOf = (id: string) => `documents.signing_keys.private_key:${id}`;

/** The region's key now: its active one, or a new one when there is none or it is a year old. */
export async function currentSigningKey(
    system: SystemDatabase,
    crypto: Pick<FieldCrypto, 'wrapSecret' | 'unwrapSecret'>,
    regionId: string,
    now = new Date()
): Promise<SigningKey> {
    return system.systemContext('documents.signing_key', async (tx) => {
        // one rotation at a time in a region: a second worker waits, then finds the new key
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`documents.signing:${regionId}`}, 0))`);
        const [active] = await tx
            .select()
            .from(signingKeys)
            .where(and(eq(signingKeys.regionId, regionId), eq(signingKeys.active, true)));
        if (active && now.getTime() - active.createdAt.getTime() < KEY_LIFETIME_MS)
            return {
                id: active.id,
                keyId: active.keyId,
                privateDer: Buffer.from(crypto.unwrapSecret(regionId, placeOf(active.id), active.privateKey), 'base64')
            };
        const [root] = await tx
            .select({ id: orgUnits.id, path: orgUnits.path })
            .from(orgUnits)
            .where(and(eq(orgUnits.regionId, regionId), sql`${orgUnits.parentId} is null`));
        if (!root) throw new Error(`no root unit in region ${regionId}`);
        actFor(tx, { regionId, unitId: root.id, scopePath: root.path });
        if (active)
            await updateAudited(tx, signingKeys, active.id, active.rowVersion, { active: false, retiredAt: now });
        return create(tx, crypto, { regionId, ownerUnitId: root.id });
    });
}

async function create(
    tx: Tx,
    crypto: Pick<FieldCrypto, 'wrapSecret'>,
    where: { regionId: string; ownerUnitId: string }
): Promise<SigningKey> {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
    // the raw 32 bytes: the end of the SubjectPublicKeyInfo
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const id = newId();
    const row = await insertAudited(tx, signingKeys, {
        id,
        ...where,
        keyId: randomBytes(4).toString('hex'),
        publicKey: encodeBase64Url(raw),
        privateKey: crypto.wrapSecret(where.regionId, placeOf(id), privateDer.toString('base64'))
    });
    return { id: row.id, keyId: row.keyId, privateDer };
}

/** The signature of `payload` by `key`. */
export const signPayload = (key: Pick<SigningKey, 'privateDer'>, payload: Uint8Array): Uint8Array =>
    sign(null, payload, createPrivateKey({ key: key.privateDer, format: 'der', type: 'pkcs8' }));

/** A new verification token: returned once for the QR; only its hash is ever stored. */
export const newVerificationToken = (): string => randomBytes(16).toString('base64url');

/** The QR as an inline image: the PDF worker fetches nothing, and a page's CSP allows only `data:`. */
export async function qrImage(text: string): Promise<string> {
    const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
