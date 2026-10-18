import { AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';

// like the real session: refresh() stores the new access token
const session = vi.hoisted(() => {
    let token = 'old-token';
    return { getAccessToken: () => token, hasRefreshToken: () => true, refresh: async () => (token = 'new-token'), clear: () => undefined };
});
vi.mock('@platform/lib/auth/session', () => ({ session }));

import client from '@platform/lib/api/client';

/** Fake transport: records each request; the first answers 401 when `expireFirst` is set. */
function transport(expireFirst: boolean) {
    const seen: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        seen.push(config);
        const status = expireFirst && seen.length === 1 ? 401 : 200;
        const response = { data: {}, status, statusText: '', headers: {}, config, request: {} };
        if (status === 401) throw Object.assign(new Error('401'), { isAxiosError: true, response, config });
        return response;
    };
    return { seen, adapter };
}

const key = (c: InternalAxiosRequestConfig) => AxiosHeaders.from(c.headers).get('Idempotency-Key');

describe('platform client', () => {
    it('sends a fresh Idempotency-Key on each POST, none on GET', async () => {
        const { seen, adapter } = transport(false);
        await client.post('x', {}, { adapter });
        await client.post('x', {}, { adapter });
        await client.get('x', { adapter });
        expect(key(seen[0])).toBeTruthy();
        expect(key(seen[1])).not.toBe(key(seen[0]));
        expect(key(seen[2])).toBeFalsy();
    });

    it('keeps the key when it retries after refreshing an expired token', async () => {
        const { seen, adapter } = transport(true);
        await client.post('x', { a: 1 }, { adapter });
        expect(seen).toHaveLength(2);
        expect(key(seen[1])).toBe(key(seen[0]));
        expect(AxiosHeaders.from(seen[1].headers).get('Authorization')).toBe('Bearer new-token');
    });

    it('respects a key the caller chose', async () => {
        const { seen, adapter } = transport(false);
        await client.post('x', {}, { adapter, headers: { 'Idempotency-Key': 'mine' } });
        expect(key(seen[0])).toBe('mine');
    });
});
