/** What a checker is told from the proof and the live status together (ADR-0046). */
import { generateKeyPairSync, sign } from 'node:crypto';

import { encodeBase64Url } from '@itrms/documents/contracts/verification-encoding';
import type { VerificationOut, VerificationPayload } from '@itrms/documents/contracts';
import type { PublishedKey } from '@itrms/documents/contracts/verification-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshKeys, storedKeys } from './keys';
import type { Lookup } from './lookup';
import { examine } from './verdict';

const TOKEN = 'abcdefghijklmnopqrstuv';
const pair = generateKeyPairSync('ed25519');
const key: PublishedKey = {
    keyId: 'k1',
    publicKey: encodeBase64Url(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
    retiredOn: null
};
const facts: VerificationPayload = {
    v: 1,
    k: 'k1',
    t: 'licence-card',
    n: 'SER-1',
    o: 'BOD',
    i: '2026-10-01',
    u: '2027-10-01',
    h: 'G******** H*****'
};
const document: VerificationOut = {
    status: 'valid',
    documentName: { am: 'ካርድ', en: 'Card' },
    number: 'SER-1',
    office: { am: 'ጽ/ቤት', en: 'Office' },
    issuedOn: '2026-10-01',
    validUntil: '2027-10-01',
    holder: 'G******** H*****'
};
const qrOf = (signed: VerificationPayload) => {
    const bytes = new TextEncoder().encode(JSON.stringify(signed));
    return `https://verify.example.test/${TOKEN}#${encodeBase64Url(bytes)}.${encodeBase64Url(sign(null, bytes, pair.privateKey))}`;
};
const scan = (text: string, live: Lookup, keys: readonly PublishedKey[] = [key], fresh: PublishedKey[] | null = null) =>
    examine(text, {
        keys: () => keys,
        refresh: () => Promise.resolve(fresh),
        lookUp: () => Promise.resolve(live),
        today: () => '2026-11-05'
    });

describe('one scan', () => {
    it('takes the live status when there is one', async () => {
        const revoked = { state: 'found', document: { ...document, status: 'revoked' } } as const;
        expect(await scan(qrOf(facts), revoked)).toEqual({ kind: 'live', lookup: revoked });
    });

    it('says what a proof alone can, in flight mode and when the API is busy', async () => {
        for (const state of ['offline', 'busy'] as const)
            expect(await scan(qrOf(facts), { state })).toEqual({ kind: 'offline', facts, expired: false });
        expect(await scan(qrOf({ ...facts, u: '2026-11-04' }), { state: 'offline' })).toMatchObject({
            kind: 'offline',
            expired: true
        });
    });

    it('calls it forged when a real token is put with another document’s facts', async () => {
        const other = { state: 'found', document: { ...document, number: 'SER-2' } } as const;
        expect(await scan(qrOf(facts), other)).toEqual({ kind: 'forged' });
    });

    it('calls it forged when the token is no document’s: a revoked document’s status can’t be cut off that way', async () => {
        expect(await scan(qrOf(facts), { state: 'unknown' })).toEqual({ kind: 'forged' });
    });

    it('asks the API nothing about a QR that fails its proof', async () => {
        const lookUp = vi.fn();
        const [address = '', proof = ''] = qrOf(facts).split('#');
        const tampered = `${address}#${encodeBase64Url(new TextEncoder().encode(JSON.stringify({ ...facts, n: 'SER-9' })))}.${proof.split('.')[1]}`;
        expect(await examine(tampered, { keys: () => [key], refresh: () => Promise.resolve(null), lookUp })).toEqual({
            kind: 'forged'
        });
        expect(lookUp).not.toHaveBeenCalled();
    });

    it('fetches the keys once when it lacks the signer, and scans with them', async () => {
        const live: Lookup = { state: 'found', document };
        expect(await scan(qrOf(facts), live, [], [key])).toEqual({ kind: 'live', lookup: live });
        expect(await scan(qrOf(facts), live, [], null)).toEqual({ kind: 'unknownKey' });
    });
});

describe('the keys on this phone', () => {
    afterEach(() => localStorage.clear());
    const answering = (status: number, body: unknown) =>
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

    it('are kept for flight mode', async () => {
        const now = new Date('2026-11-05T06:00:00Z');
        await refreshKeys(answering(200, { keys: [key] }), now);
        expect(storedKeys()).toEqual({ keys: [key], updatedAt: now.toISOString() });
    });

    it('stay as they are if the answer is no answer, or not a key list', async () => {
        await refreshKeys(answering(200, { keys: [key] }));
        const before = storedKeys();
        expect(await refreshKeys(answering(500, {}))).toBeNull();
        expect(await refreshKeys(answering(200, { keys: [{ keyId: 1 }] }))).toBeNull();
        const down = vi.fn(() => Promise.reject(new Error('no network'))) as unknown as typeof fetch;
        expect(await refreshKeys(down)).toBeNull();
        expect(storedKeys()).toEqual(before);
    });

    it('are nothing if storage holds something else', () => {
        localStorage.setItem('itrms.verify.keys.v1', '{not json');
        expect(storedKeys()).toBeNull();
    });
});
