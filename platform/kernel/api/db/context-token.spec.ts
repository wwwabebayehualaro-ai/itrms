import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { carriesIdentity, contextKeyId, CONTEXT_TTL_SECONDS, signContext } from './context-token';

const KEY = Buffer.alloc(32, 7);

/** The three parts of a token: the first two never contain ':'; the JSON may. */
const parts = (token: string) => {
    const [mac = '', kid = ''] = token.split(':');
    return { mac, kid, body: token.slice(mac.length + kid.length + 2) };
};

describe('signContext', () => {
    it('is <mac>:<kid>:<json>, the MAC over kid + ":" + json', () => {
        const token = signContext({ userId: 'u1', regionId: 'r1', requestId: 'req-1' }, KEY, { now: 1_000_000 });
        const { mac, kid, body } = parts(token);
        expect(kid).toBe(contextKeyId(KEY));
        expect(kid).toMatch(/^[0-9a-f]{16}$/);
        expect(mac).toBe(createHmac('sha256', KEY).update(`${kid}:${body}`).digest('hex'));
        expect(JSON.parse(body)).toEqual({ exp: 1000 + CONTEXT_TTL_SECONDS, usr: 'u1', reg: 'r1', req: 'req-1' });
    });

    it('carries every field and keeps a colon in a value apart from the separators', () => {
        const token = signContext(
            {
                userId: 'u',
                regionId: 'r',
                unitId: 'n',
                scopePath: 'et.snnp.wolaita',
                partyId: 'p',
                subject: 'a:b',
                requestId: 'q',
                ip: '::1'
            },
            KEY
        );
        expect(JSON.parse(parts(token).body)).toMatchObject({
            usr: 'u',
            reg: 'r',
            unit: 'n',
            scope: 'et.snnp.wolaita',
            party: 'p',
            sub: 'a:b',
            req: 'q',
            ip: '::1'
        });
    });

    it('differs with the key, and a key has a stable id', () => {
        const other = randomBytes(32);
        const a = signContext({ userId: 'u' }, KEY, { now: 5 });
        const b = signContext({ userId: 'u' }, other, { now: 5 });
        expect(parts(a).mac).not.toBe(parts(b).mac);
        expect(parts(a).kid).not.toBe(parts(b).kid);
        expect(contextKeyId(KEY)).toBe(contextKeyId(Buffer.from(KEY)));
    });

    it('honours the lifetime', () => {
        const { body } = parts(signContext({}, KEY, { now: 10_000, ttlSeconds: 5 }));
        expect(JSON.parse(body)).toEqual({ exp: 15 });
    });
});

describe('carriesIdentity', () => {
    it('is false for a request id and an address alone', () => {
        expect(carriesIdentity({ requestId: 'x', ip: '1.2.3.4' })).toBe(false);
        expect(carriesIdentity({ subject: 's' })).toBe(true);
        expect(carriesIdentity({ scopePath: 'et' })).toBe(true);
    });
});
