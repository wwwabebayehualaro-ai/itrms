/**
 * The verifier's check against the API's signer (ADR-0046, task 0.23c): a good QR passes, and any change to it fails. The real
 * worker's QR is checked the same way in the integration suite.
 */
import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encodeBase64Url, payloadBytes, verificationPayloadSchema, verificationUrl } from '../contracts';
import {
    addisToday,
    checkQr,
    isVerificationPayload,
    sameDocument,
    type PublishedKey
} from '../contracts/verification-check';
import { signPayload } from '../api/pdf-worker';

const TOKEN = 'abcdefghijklmnopqrstuv';
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

const qrOf = (facts: typeof FACTS | Record<string, unknown>, key = KEY) => {
    const bytes = new TextEncoder().encode(JSON.stringify(facts));
    return verificationUrl(BASE, TOKEN, bytes, signPayload(key.signer, bytes));
};

describe('a QR from the API’s signer', () => {
    it('is genuine, with its facts, and says so with no network', async () => {
        const bytes = payloadBytes(FACTS);
        const qr = verificationUrl(BASE, TOKEN, bytes, signPayload(KEY.signer, bytes));
        expect(await checkQr(qr, [KEY.published], TODAY)).toEqual({
            state: 'genuine',
            token: TOKEN,
            facts: FACTS,
            expired: false
        });
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

    it('fails when the signature is changed, cut or missing', async () => {
        const qr = qrOf(FACTS);
        const [address = '', proof = ''] = qr.split('#');
        const [payload = '', signature = ''] = proof.split('.');
        const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        for (const bad of [
            `${address}#${payload}.${flipped}`,
            `${address}#${payload}.${signature.slice(0, 40)}`,
            `${address}#${payload}.`,
            `${address}#${payload}`,
            address,
            `${address}#${payload}.${signature}.more`,
            `${address}#not-json.${signature}`
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

describe('a live answer beside a proof', () => {
    const live = {
        status: 'valid' as const,
        documentName: { am: 'ካርድ', en: 'Card' },
        number: 'SER-1',
        office: { am: 'ጽ/ቤት', en: 'Office' },
        issuedOn: '2026-10-01',
        validUntil: '2027-10-01',
        holder: 'G******** H*****'
    };
    it('is the same document only if every shared fact agrees', () => {
        expect(sameDocument(FACTS, live)).toBe(true);
        for (const change of [
            { number: 'SER-2' },
            { issuedOn: '2026-10-02' },
            { validUntil: null },
            { holder: 'X* Y*' }
        ])
            expect(sameDocument(FACTS, { ...live, ...change })).toBe(false);
    });
});

describe('today', () => {
    it('is Ethiopia’s, three hours ahead of UTC', () => {
        expect(addisToday(new Date('2026-11-05T20:59:00Z'))).toBe('2026-11-05');
        expect(addisToday(new Date('2026-11-05T21:00:00Z'))).toBe('2026-11-06');
    });
});
