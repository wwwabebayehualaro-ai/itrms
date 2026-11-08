/** Number plates: the national format, the old regional ones in both scripts and any order, the special ones. */
import { describe, expect, it } from 'vitest';

import { foldPlate, nationalPlateText, parsePlate } from '../contracts/plate';

describe('parsePlate', () => {
    it('reads the national plate in either script and in any case or spacing', () => {
        for (const typed of ['ኢት abc-1234', 'ETH ABC 1234', 'eth.abc.1234', 'ኢትABC1234'])
            expect(parsePlate(typed)).toEqual({
                format: 'national',
                key: 'ETHABC1234',
                text: 'ETH ABC 1234',
                useCode: null,
                regionCode: null
            });
        expect(nationalPlateText('ETHABC1234', 'ethiopic')).toBe('ኢት ABC 1234');
    });

    it('folds Unicode (a full-width writing is the same plate)', () => {
        expect(foldPlate('ＥＴＨ ＡＢＣ １２３４')).toBe('ETHABC1234');
        expect(parsePlate('ＥＴＨ ＡＢＣ １２３４')?.key).toBe('ETHABC1234');
    });

    it('rejects a national plate with the wrong shape', () => {
        for (const bad of ['ETH AB 1234', 'ETH ABCD 1234', 'ETH ABC 123', 'ABC 1234', '', '   '])
            expect(parsePlate(bad)).toBeNull();
    });

    it('reads an old regional plate in Latin and Ethiopic letters, the region before, between or after', () => {
        const expected = {
            format: 'legacy',
            key: 'L3ORA12345',
            text: 'OR 3-A12345',
            useCode: 3,
            regionCode: 'OR'
        };
        for (const typed of ['OR 3-A12345', '3 A 12345 OR', '3-OR-A12345', 'ኦሮ 3 A12345', '3-A12345 ኦሮ', 'or3a12345'])
            expect(parsePlate(typed), typed).toEqual(expected);
        expect(parsePlate('AA 2-54321')).toMatchObject({ key: 'L2AA54321', regionCode: 'AA', useCode: 2 });
        expect(parsePlate('አአ 2-54321')?.key).toBe('L2AA54321');
    });

    it('refuses a series letter in Ethiopic (a key is letters A-Z and digits)', () => {
        expect(parsePlate('ኦሮ 3-ሀ12345')).toBeNull();
    });

    it('rejects an old plate with a use code out of 1 to 5, too few digits or an unknown region', () => {
        for (const bad of ['OR 6-12345', 'OR 3-123', 'XX 3-12345', 'OR 123']) expect(parsePlate(bad), bad).toBeNull();
    });

    it('knows the regions a setting gives it', () => {
        expect(parsePlate('ZZ 1-1234')).toBeNull();
        expect(parsePlate('ዘዘ 1-1234', [{ code: 'ZZ', aliases: ['ዘዘ'] }])).toMatchObject({
            key: 'L1ZZ1234',
            regionCode: 'ZZ'
        });
    });

    it('reads the diplomatic, international-organisation and police plates as special', () => {
        expect(parsePlate('CD 123')).toMatchObject({ format: 'special', key: 'CD123' });
        expect(parsePlate('un-45')).toMatchObject({ format: 'special', key: 'UN45' });
        expect(parsePlate('AU 7')).toMatchObject({ format: 'special', key: 'AU7' });
        expect(parsePlate('ፖሊስ 1234')).toMatchObject({ format: 'special', key: 'POLICE1234' });
    });
});
