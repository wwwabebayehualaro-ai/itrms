import { describe, expect, it } from 'vitest';

import { requestHash as hashOf } from '../idempotency/idempotency';
import { formatNumber } from './numbering';

describe('numbers (architecture.md §15)', () => {
    it('fill the pattern: the unit, the zero-padded number and the fiscal year', () => {
        expect(formatNumber('{unit}/{seq:06}/{efy}', { unit: 'WOL-BODITI', seq: 42n, efy: 2019 })).toBe(
            'WOL-BODITI/000042/2019'
        );
        expect(formatNumber('R-{seq}', { unit: 'X', seq: 1234567n, efy: 2019 })).toBe('R-1234567');
        // a number longer than the padding is never cut
        expect(formatNumber('{seq:03}', { unit: 'X', seq: 12345n, efy: 2019 })).toBe('12345');
    });
});

describe('idempotency request hashes', () => {
    const KEY = Buffer.alloc(32, 7);
    const requestHash = (...args: [string, string, string, unknown]) => hashOf(KEY, ...args);

    it('are keyed: another key, another hash (a body is never recoverable by trying values)', () => {
        const body = { phone: '+251911000001' };
        expect(hashOf(Buffer.alloc(32, 8), 'POST', '/p', 'u', body)).not.toBe(requestHash('POST', '/p', 'u', body));
    });

    it('are the same for the same request whatever the order of its fields, and differ for any other', () => {
        const a = requestHash('POST', '/api/v1/x', 'unit-1', { b: 1, a: { d: [1, 2], c: 'x' } });
        expect(requestHash('POST', '/api/v1/x', 'unit-1', { a: { c: 'x', d: [1, 2] }, b: 1 })).toBe(a);
        expect(requestHash('POST', '/api/v1/x', 'unit-2', { b: 1, a: { d: [1, 2], c: 'x' } })).not.toBe(a);
        expect(requestHash('POST', '/api/v1/x', 'unit-1', { b: 1, a: { d: [2, 1], c: 'x' } })).not.toBe(a);
        expect(requestHash('POST', '/api/v1/y', 'unit-1', { b: 1, a: { d: [1, 2], c: 'x' } })).not.toBe(a);
    });
});
