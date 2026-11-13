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

    it('tells two regions apart by the code standing apart, and refuses a plate it cannot tell', () => {
        // `3SOR1234` reads as Somali series R or as Oromia series S: written apart, each is one plate with one key
        for (const typed of ['3-SO-R1234', 'SO 3-R1234', 'ሶማ 3-R1234'])
            expect(parsePlate(typed), typed).toMatchObject({ key: 'L3SOR1234', regionCode: 'SO' });
        for (const typed of ['3-OR-S1234', 'OR 3-S1234'])
            expect(parsePlate(typed), typed).toMatchObject({ key: 'L3ORS1234', regionCode: 'OR' });
        expect(parsePlate('3 SD D1234')).toMatchObject({ key: 'L3SDD1234', regionCode: 'SD' });
        expect(parsePlate('3 DD S1234')).toMatchObject({ key: 'L3DDS1234', regionCode: 'DD' });
        // run together, it is either: refused, never guessed
        expect(parsePlate('3SOR1234')).toBeNull();
    });

    it('ignores an alias that folds to nothing (it would match everywhere)', () => {
        const regions = [{ code: 'ZZ', aliases: ['-', '.', ' / '] }];
        expect(parsePlate('1HGCM82633A004352', regions)).toBeNull();
        expect(parsePlate('ZZ 1-1234', regions)).toMatchObject({ key: 'L1ZZ1234' });
    });

    it('reads the diplomatic, international-organisation and police plates as special', () => {
        expect(parsePlate('CD 123')).toMatchObject({ format: 'special', key: 'CD123' });
        expect(parsePlate('un-45')).toMatchObject({ format: 'special', key: 'UN45' });
        expect(parsePlate('AU 7')).toMatchObject({ format: 'special', key: 'AU7' });
        expect(parsePlate('ፖሊስ 1234')).toMatchObject({ format: 'special', key: 'POLICE1234' });
    });

    it('reads the defence and special (machinery) plates as special, in either script (task 1.2c, a stated assumption)', () => {
        expect(parsePlate('መከላከያ 4521')).toMatchObject({ format: 'special', key: 'DEFENCE4521', text: 'DEFENCE 4521' });
        expect(parsePlate('defence-12')).toMatchObject({ format: 'special', key: 'DEFENCE12' });
        expect(parsePlate('ልዩ 0331')).toMatchObject({ format: 'special', key: 'SPECIAL0331' });
    });

    it('reads the local-NGO code 35, told apart from code 3 only by how it is written (task 1.2c)', () => {
        expect(parsePlate('SN 35-1234')).toMatchObject({ key: 'L35SN1234', useCode: 35, regionCode: 'SN' });
        expect(parsePlate('ደቡ 35-A1234')).toMatchObject({ key: 'L35SNA1234', useCode: 35 });
        // a series letter after 35 can only be code 35
        expect(parsePlate('SN 35A1234')).toMatchObject({ key: 'L35SNA1234', useCode: 35 });
        expect(parsePlate('SN 3-51234')).toMatchObject({ key: 'L3SN51234', useCode: 3 });
        // run together it is code 3 with 51234, or code 35 with 1234: refused, never guessed
        expect(parsePlate('SN 351234')).toBeNull();
        // the other codes are as they were
        expect(parsePlate('SN 3-12345')).toMatchObject({ key: 'L3SN12345', useCode: 3 });
    });
});
