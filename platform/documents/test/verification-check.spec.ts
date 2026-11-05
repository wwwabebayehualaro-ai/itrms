/**
 * The verifier's check against the API's signer (ADR-0046, task 0.23c): a good QR passes, and any change to it fails. The real
 * worker's QR is checked the same way in the integration suite.
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
    encodeBase64Url,
    payloadBytes,
    signedBytes,
    verificationKeysOutSchema,
    verificationPayloadSchema,
    verificationUrl
} from '../contracts';
import { addisToday, checkQr, isVerificationPayload, type PublishedKey } from '../contracts/verification-check';
import { signPayload } from '../api/pdf-worker';

const TOKEN = 'abcdefghijklmnopqrstuv';
const OTHER_TOKEN = 'zyxwvutsrqponmlkjihgfe';
const BASE = 'https://verify.example.test';
const TODAY = '2026-11-05';

const newKey = (keyId: string, retiredOn: string | null = null) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const published: PublishedKey = {
        keyId,
        publicKey: encodeBase64Url(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
        retiredOn
    };
    return { published, signer: { privateDer: privateKey.export({ format: 'der', type: 'pkcs8' }) } };
};

const KEY = newKey('k1');
const FACTS = {
    v: 1 as const,
    k: 'k1',
    t: 'licence-card',
    n: 'SER-1',
    o: 'BOD',
    i: '2026-10-01',
    u: '2027-10-01',
    h: 'G******** H*****'
};

const qrOf = (facts: typeof FACTS | Record<string, unknown>, key = KEY, token = TOKEN) => {
    const bytes = new TextEncoder().encode(JSON.stringify(facts));
    return verificationUrl(BASE, token, bytes, signPayload(key.signer, signedBytes(token, bytes)));
};

describe('a QR from the API’s signer', () => {
    it('is genuine, with its facts, and says so with no network', async () => {
        const bytes = payloadBytes(FACTS);
        const qr = verificationUrl(BASE, TOKEN, bytes, signPayload(KEY.signer, signedBytes(TOKEN, bytes)));
        const fetcher = vi.fn();
        vi.stubGlobal('fetch', fetcher);
        expect(await checkQr(qr, [KEY.published], TODAY)).toEqual({
            state: 'genuine',
            token: TOKEN,
            facts: FACTS,
            expired: false
        });
        expect(fetcher).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('is expired from the day after its last day', async () => {
        const last = { ...FACTS, u: TODAY };
        expect(await checkQr(qrOf(last), [KEY.published], TODAY)).toMatchObject({ expired: false });
        expect(await checkQr(qrOf(last), [KEY.published], '2026-11-06')).toMatchObject({ expired: true });
    });

    it('fails when a signed fact is changed', async () => {
        const [address = '', proof = ''] = qrOf(FACTS).split('#');
        const signature = proof.split('.')[1];
        for (const change of [{ n: 'SER-2' }, { u: '2099-01-01' }, { h: 'X* Y*' }, { i: '2026-10-02' }]) {
            const changed = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ ...FACTS, ...change })));
            expect(await checkQr(`${address}#${changed}.${signature}`, [KEY.published], TODAY)).toEqual({
                state: 'forged',
                token: TOKEN
            });
        }
    });

    it('fails beside another document’s token: a revocation can’t be hidden that way, even offline', async () => {
        const swapped = qrOf(FACTS).replace(TOKEN, OTHER_TOKEN);
        expect(await checkQr(swapped, [KEY.published], TODAY)).toEqual({ state: 'forged', token: OTHER_TOKEN });
        // and it was signed for its own, which passes
        expect(await checkQr(qrOf(FACTS, KEY, OTHER_TOKEN), [KEY.published], TODAY)).toMatchObject({
            state: 'genuine',
            token: OTHER_TOKEN
        });
    });

    it('fails when the signature is changed, cut or missing', async () => {
        const qr = qrOf(FACTS);
        const [address = '', proof = ''] = qr.split('#');
        const [payload = '', signature = ''] = proof.split('.');
        const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        const lastFlipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
        for (const bad of [
            `${address}#${payload}.${flipped}`,
            `${address}#${payload}.${lastFlipped}`,
            `${address}#${payload}.${'A'.repeat(86)}`,
            `${address}#${payload}.${signature.slice(0, 40)}`,
            `${address}#${payload}.`,
            `${address}#${payload}`,
            address,
            `${address}#${payload}.${signature}.more`,
            `${address}#not-json.${signature}`,
            `${address}#%%%.${signature}`
        ])
            expect(await checkQr(bad, [KEY.published], TODAY), bad).toEqual({ state: 'forged', token: TOKEN });
    });

    it('fails when signed by anyone else under the same key id', async () => {
        const other = newKey('k1');
        expect(await checkQr(qrOf(FACTS, other), [KEY.published], TODAY)).toMatchObject({ state: 'forged' });
    });

    it('is not of a key this phone lacks, which is not the same as forged', async () => {
        const other = newKey('k2');
        expect(await checkQr(qrOf({ ...FACTS, k: 'k2' }, other), [KEY.published], TODAY)).toEqual({
            state: 'unknownKey',
            token: TOKEN
        });
        expect(await checkQr(qrOf(FACTS), [], TODAY)).toMatchObject({ state: 'unknownKey' });
    });

    it('by a retired key stays good for what it signed before it retired, and only that', async () => {
        const retired = newKey('old', '2026-06-30');
        const qr = (i: string) => qrOf({ ...FACTS, k: 'old', i }, retired);
        expect(await checkQr(qr('2026-06-30'), [retired.published], TODAY)).toMatchObject({ state: 'genuine' });
        expect(await checkQr(qr('2026-07-01'), [retired.published], TODAY)).toEqual({ state: 'forged', token: TOKEN });
    });

    it('throws, rather than calling a real document forged, when the check can’t run on this phone', async () => {
        vi.stubGlobal('crypto', {});
        await expect(checkQr(qrOf(FACTS), [KEY.published], TODAY)).rejects.toThrow();
        vi.unstubAllGlobals();
    });
});

describe('what is not a document’s QR', () => {
    it.each([
        'hello',
        '',
        'javascript:alert(1)',
        'mailto:someone@example.test',
        `ftp://verify.example.test/${TOKEN}`,
        'https://verify.example.test/',
        'https://verify.example.test/short#a.b',
        `https://verify.example.test/a/${TOKEN}#a.b`
    ])('is not ours: %s', async (text) => {
        expect(await checkQr(text, [KEY.published], TODAY)).toEqual({ state: 'notOurs' });
    });
});

describe('the payload’s hand-written guard', () => {
    it.each([
        [FACTS],
        [{ ...FACTS, n: null, u: null, h: null }],
        [{ ...FACTS, o: '' }],
        [{ ...FACTS, v: 2 }],
        [{ ...FACTS, k: '' }],
        [{ ...FACTS, t: 3 }],
        [{ ...FACTS, n: 1 }],
        [{ ...FACTS, i: 'today' }],
        [{ ...FACTS, u: undefined }],
        [{ ...FACTS, h: undefined }],
        [null],
        ['text']
    ])('agrees with the contract on %j', (value) => {
        expect(isVerificationPayload(value)).toBe(verificationPayloadSchema.safeParse(value).success);
    });
});

describe('the list of keys', () => {
    it('allows a retired key, and a key the check can read', () => {
        expect(
            verificationKeysOutSchema.safeParse({
                documents: [{ key: 'receipt', name: { am: 'ደረሰኝ', en: 'Receipt' } }],
                keys: [KEY.published, { ...KEY.published, keyId: 'old', retiredOn: '2026-06-30' }]
            }).success
        ).toBe(true);
    });
});

describe('today', () => {
    it('is Ethiopia’s, three hours ahead of UTC', () => {
        expect(addisToday(new Date('2026-11-05T20:59:00Z'))).toBe('2026-11-05');
        expect(addisToday(new Date('2026-11-05T21:00:00Z'))).toBe('2026-11-06');
    });
});
