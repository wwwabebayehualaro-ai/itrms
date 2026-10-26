// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { FIELD_TYPES, readDocument, shapeError, valueKindOf } from './';

const field = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const f = readDocument({ fields: [{ id: 'x', type, props, ...extra }] }).fields[0];
    if (!f) throw new Error('unreadable');
    return f;
};

const NOT_VALUE_TYPES = ['Card', 'DataTable', 'Divider', 'Fieldset', 'FormSection', 'Panel'];

describe('valueKindOf', () => {
    it('gives every value type of the kit a kind, and containers and display fields none', () => {
        for (const type of FIELD_TYPES) {
            if (NOT_VALUE_TYPES.includes(type)) expect(valueKindOf(field(type)), type).toBeNull();
            else expect(valueKindOf(field(type)), type).not.toBeNull();
        }
    });
    it('follows the props of Dropdown, Slider and Calendar', () => {
        expect(valueKindOf(field('Dropdown'))).toBe('choice');
        expect(valueKindOf(field('Dropdown', { multiple: true }))).toBe('multi');
        expect(valueKindOf(field('Slider'))).toBe('number');
        expect(valueKindOf(field('Slider', { range: true }))).toBe('range');
        expect(valueKindOf(field('Calendar'))).toBe('date');
        expect(valueKindOf(field('Calendar', { showTime: true }))).toBe('datetime');
        expect(valueKindOf(field('EthDate'))).toBe('ethdate');
        expect(valueKindOf(field('FormArray'))).toBe('rows');
        expect(valueKindOf(field('Password'))).toBe('text');
    });
});

describe('shapeError', () => {
    const ok = (type: string, value: unknown, props: Record<string, unknown> = {}) =>
        expect(shapeError(field(type, props), value), `${type} ${JSON.stringify(value)}`).toBeUndefined();
    const bad = (type: string, value: unknown, props: Record<string, unknown> = {}) =>
        expect(shapeError(field(type, props), value), `${type} ${JSON.stringify(value)}`).toEqual(expect.any(String));

    it('lets a blank through for every kind', () => {
        for (const type of [
            'InputText',
            'InputNumber',
            'Checkbox',
            'Calendar',
            'EthDate',
            'Dropdown',
            'MultiSelect',
            'FileUpload'
        ])
            for (const blank of [undefined, null, '']) ok(type, blank);
    });
    it('text: a string or a finite number', () => {
        ok('InputText', 'a');
        ok('InputText', 5);
        bad('InputText', {});
        bad('InputText', ['a']);
        bad('InputText', true);
        bad('InputText', Number.NaN);
    });
    it('number: a finite number or a numeric string, not coerced', () => {
        ok('InputNumber', 5);
        ok('InputNumber', '5.5');
        bad('InputNumber', {});
        bad('InputNumber', 'abc');
        bad('InputNumber', '  ');
        bad('InputNumber', Infinity);
    });
    it('boolean, date, datetime', () => {
        ok('Checkbox', false);
        bad('Checkbox', 'yes');
        ok('Calendar', '2026-09-11');
        ok('Calendar', ['2026-09-11', '2026-09-12']);
        bad('Calendar', 'not a date');
        ok('Calendar', '2026-09-11T10:00:00.000Z', { showTime: true });
        bad('Calendar', '2026-09-11', { showTime: true });
    });
    it('ethdate: a strict ISO day', () => {
        ok('EthDate', '2026-09-11');
        bad('EthDate', '2026-02-30');
        bad('EthDate', '2026-09-11T00:00:00Z');
        bad('EthDate', 20260911);
    });
    it('choice, multi, range, files', () => {
        ok('RadioButton', 'a');
        ok('Dropdown', { id: 1 });
        bad('Dropdown', ['a']);
        ok('MultiSelect', ['a', 1, { id: 2 }]);
        bad('MultiSelect', 'a');
        bad('MultiSelect', [['a']]);
        ok('Slider', [1, 2], { range: true });
        bad('Slider', [1], { range: true });
        bad('Slider', [1, '2'], { range: true });
        // what the engine records for an upload (host/files.ts), and what older forms stored
        ok('FileUpload', [
            { file_id: 'f', url: '/api/v1/files/f/download', filename: 'a.png', content_type: 'image/png', size: 5 }
        ]);
        ok('FileUpload', [{ name: 'a.pdf', size: 10 }]);
        ok('FileUpload', [{ file_id: 'f', filename: 'empty.txt', size: 0 }]);
        bad('FileUpload', 'x');
        bad('FileUpload', [{ size: 5 }]);
        bad('FileUpload', [{ file_id: 'f', size: -1 }]);
        bad('FileUpload', [{ file_id: 'f', size: '5' }]);
    });
    it("uses the author's type message", () => {
        const f = field(
            'InputNumber',
            {},
            { behavior: { validation: { supported: true, errorMessages: { type: 'Numbers only' } } } }
        );
        expect(shapeError(f, 'abc')).toBe('Numbers only');
    });
});
