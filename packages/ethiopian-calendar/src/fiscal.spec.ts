import { describe, expect, it } from 'vitest';

import { toGregorian } from './convert';

describe('Hamle 1', () => {
    it('falls on 8 July in every year from 1900 to 2099 (the database computes the fiscal year from that)', () => {
        for (let gregorianYear = 1900; gregorianYear <= 2099; gregorianYear++)
            expect(toGregorian({ year: gregorianYear - 8, month: 11, day: 1 })).toEqual({
                year: gregorianYear,
                month: 7,
                day: 8
            });
    });
});
