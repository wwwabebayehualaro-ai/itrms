/** The chassis number: its normal form and the ISO 3779 check digit (binding only in North America and China). */
import { describe, expect, it } from 'vitest';

import { parseVin, searchKeys, vehicleSearchKey, vinCheckDigit } from '../contracts/vin';

describe('parseVin', () => {
    it('accepts a valid ISO 3779 VIN, typed in lower case with spaces or hyphens', () => {
        expect(parseVin('1M8GDM9AXKP042788')).toEqual({
            ok: true,
            chassisNumber: '1M8GDM9AXKP042788',
            chassisKind: 'iso3779',
            vinKey: '1M8GDM9AXKP042788',
            vinCheck: 'ok'
        });
        expect(parseVin(' 1m8g-dm9a xkp 042788 ')).toMatchObject({ ok: true, vinKey: '1M8GDM9AXKP042788' });
    });

    it('computes the check digit', () => {
        expect(vinCheckDigit('1M8GDM9AXKP042788')).toBe('X');
        expect(vinCheckDigit('11111111111111111')).toBe('1');
    });

    it('refuses the letters I, O and Q', () => {
        for (const bad of ['1M8GDM9AXKP04278I', 'OM8GDM9AXKP042788', '1M8GDM9AXKQ042788'])
            expect(parseVin(bad)).toEqual({ ok: false, code: 'invalid_vin', problem: 'invalid_chars' });
    });

    it('refuses a wrong check digit where it binds (North American and Chinese WMIs)', () => {
        expect(parseVin('1M8GDM9A1KP042788')).toEqual({ ok: false, code: 'invalid_vin', problem: 'check_digit' });
        expect(parseVin('LFV2A21J540000001')).toMatchObject({ ok: false, problem: 'check_digit' });
    });

    it('records a wrong check digit that binds as a mismatch when the officer accepts it', () => {
        expect(parseVin('1M8GDM9A1KP042788', { acceptMismatch: true })).toMatchObject({
            ok: true,
            chassisKind: 'iso3779',
            vinCheck: 'mismatch'
        });
        expect(parseVin('LFV2A21J540000001', { acceptMismatch: true })).toMatchObject({
            ok: true,
            vinCheck: 'mismatch'
        });
        // a right digit stays ok, and other refusals stay refusals
        expect(parseVin('1M8GDM9AXKP042788', { acceptMismatch: true })).toMatchObject({ ok: true, vinCheck: 'ok' });
        expect(parseVin('1M8GDM9A1KP04278', { acceptMismatch: true })).toMatchObject({
            ok: false,
            problem: 'invalid_length'
        });
    });

    it('flags a wrong check digit as a warning where it does not bind (a Japanese WMI)', () => {
        const right = 'JHMCM56557C404453';
        const digit = vinCheckDigit(right);
        expect(digit).toBe('5');
        expect(parseVin(right)).toMatchObject({ ok: true, vinCheck: 'ok' });
        expect(parseVin('JHMCM56547C404453')).toMatchObject({ ok: true, chassisKind: 'iso3779', vinCheck: 'mismatch' });
    });

    it('needs the other kind for a chassis number that is not 17 characters, or from before 1981', () => {
        expect(parseVin('AB-12345')).toEqual({ ok: false, code: 'invalid_vin', problem: 'invalid_length' });
        expect(parseVin('AB-12345', { chassisKind: 'other' })).toEqual({
            ok: true,
            chassisNumber: 'AB12345',
            chassisKind: 'other',
            vinKey: 'AB12345',
            vinCheck: 'not_applicable'
        });
        expect(parseVin('1M8GDM9AXKP042788', { modelYear: 1975 })).toEqual({
            ok: false,
            code: 'invalid_vin',
            problem: 'needs_other_kind'
        });
        expect(parseVin('1M8GDM9AXKP042788', { modelYear: 1975, chassisKind: 'other' })).toMatchObject({
            ok: true,
            chassisKind: 'other'
        });
        expect(parseVin('AB', { chassisKind: 'other' })).toMatchObject({ ok: false, problem: 'invalid_other' });
    });

    it('keeps an other-kind chassis number findable the way it is searched (I as 1, O and Q as 0)', () => {
        expect(parseVin('ab-o1i23', { chassisKind: 'other' })).toMatchObject({ vinKey: 'AB01123' });
    });
});

describe('the other kind of chassis number', () => {
    it('is refused for a VIN-shaped number of a vehicle from 1981 on (its uniqueness and check digit apply)', () => {
        expect(parseVin('1M8GDM9AXKP042788', { chassisKind: 'other' })).toEqual({
            ok: false,
            code: 'invalid_vin',
            problem: 'iso_vin_as_other'
        });
        expect(parseVin('1M8GDM9AXKP042788', { chassisKind: 'other', modelYear: 2020 })).toMatchObject({ ok: false });
    });

    it('is refused when its search key is shorter than 4 characters', () => {
        expect(parseVin('A./B', { chassisKind: 'other' })).toMatchObject({ ok: false, problem: 'invalid_other' });
    });
});

describe('search keys', () => {
    it('reads a typed VIN with spaces, lower case and an O for a 0', () => {
        expect(vehicleSearchKey('1m8g dm9a xkp O42788')).toBe('1M8GDM9AXKP042788');
        expect(vehicleSearchKey('kp042788')).toBe('KP042788');
    });

    it('keeps hyphens for a federal id and drops them for a plate', () => {
        expect(searchKeys('ab-12-cd 3')).toEqual({ key: 'AB-12-CD3', plateKey: 'AB12CD3' });
    });
});
