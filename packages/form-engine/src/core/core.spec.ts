// @vitest-environment node
// core runs in the API too: these tests run without a DOM.
import { describe, expect, it } from 'vitest';

import { evaluateAll, initialValues, pruneHidden, readDocument, validateForm } from './';

type Settings = Record<string, unknown>;
interface Extra {
    category?: string;
    props?: Settings;
    parentId?: string;
    defaults?: Settings;
    data?: Settings;
    validation?: Settings;
    behavior?: Settings;
}

function at<T>(list: readonly T[], i: number): T {
    const item = list[i];
    if (item === undefined) throw new Error(`no item ${i}`);
    return item;
}

/** A stored field the way the builder writes it (validation on, palette defaults in data.defaultProps). */
const field = (type: string, id: string, extra: Extra = {}) => ({
    id,
    type,
    label: id,
    category: extra.category ?? (['Panel', 'Card', 'Fieldset', 'FormArray'].includes(type) ? 'Layout' : 'Input'),
    props: extra.props ?? {},
    parentId: extra.parentId,
    data: { defaultProps: extra.defaults ?? {}, ...extra.data },
    behavior: { validation: { supported: true, ...extra.validation }, ...extra.behavior },
    layout: { options: { isContainer: ['Panel', 'Card', 'Fieldset', 'FormArray'].includes(type) } }
});
const req = (f: ReturnType<typeof field>) => ({ ...f, props: { ...f.props, required: true } });

describe('readDocument', () => {
    it('reads every stored version and reports what it cannot read', () => {
        expect(readDocument([field('InputText', 'a')]).fields.map((f) => f.id)).toEqual(['a']);
        expect(readDocument({ fields: [field('InputText', 'a')], runtime: { dataSources: [] } }).runtime).toEqual({
            dataSources: []
        });
        const doc = readDocument({
            schemaVersion: 2,
            fields: [field('InputText', 'a'), field('InputText', 'a'), { nope: true }]
        });
        expect(doc.storedVersion).toBe(2);
        expect(doc.fields).toHaveLength(1);
        expect(doc.invalid.map((i) => i.index)).toEqual([1, 2]);
        expect(readDocument(null).fields).toEqual([]);
    });

    it('resolves settings with props over palette defaults', () => {
        const f = at(
            readDocument([
                field('InputText', 'a', {
                    defaults: { placeholder: 'palette', rows: 3 },
                    props: { placeholder: 'author' }
                })
            ]).fields,
            0
        );
        expect(f.props).toMatchObject({ placeholder: 'author', rows: 3 });
    });

    it('takes Required from the property, else from the palette rule list', () => {
        const fields = readDocument([
            req(field('InputText', 'a')),
            field('InputText', 'b', { validation: { types: ['required'] } }),
            field('InputText', 'c', { props: { required: false }, validation: { types: ['required'] } })
        ]).fields;
        expect([0, 1, 2].map((i) => at(fields, i).rules.required)).toEqual([true, true, false]);
    });
});

describe('conditions', () => {
    const values = { kind: 'b', amount: 80, tags: ['x'] };
    it('combines a list with its logic, groups and not', () => {
        expect(
            evaluateAll(
                [
                    { field: 'kind', operator: 'eq', value: 'a' },
                    { field: 'amount', operator: 'gt', value: 50 }
                ],
                values
            )
        ).toBe(false);
        expect(
            evaluateAll(
                [
                    { field: 'kind', operator: 'eq', value: 'a', logic: 'or' },
                    { field: 'amount', operator: 'gt', value: 50 }
                ],
                values
            )
        ).toBe(true);
        expect(
            evaluateAll(
                [
                    { field: 'kind', operator: 'eq', value: 'b', logic: 'xor' },
                    { field: 'amount', operator: 'gt', value: 50 }
                ],
                values
            )
        ).toBe(false);
        expect(
            evaluateAll(
                [{ field: '', operator: 'not', conditions: [{ field: 'kind', operator: 'eq', value: 'b' }] }],
                values
            )
        ).toBe(false);
        expect(evaluateAll([{ field: 'tags', operator: 'contains', value: 'x' }], values)).toBe(true);
        expect(
            evaluateAll([{ field: 'user.role', operator: 'eq', value: 'admin' }], values, { user: { role: 'admin' } })
        ).toBe(true);
        expect(evaluateAll([], values)).toBe(true);
    });
});

describe('validation and submitted values', () => {
    const show = { behavior: { visibilityConditions: [{ field: 'kind', operator: 'eq', value: 'other' }] } };

    it('checks visible fields only; a hidden container hides its children', () => {
        const doc = readDocument([
            req(field('InputText', 'kind')),
            req(field('InputText', 'detail', show)),
            field('Panel', 'extra', show),
            req(field('InputNumber', 'cost', { parentId: 'extra' }))
        ]);
        expect(validateForm(doc.fields, initialValues(doc.fields))).toEqual({ kind: 'This field is required' });
        expect(Object.keys(validateForm(doc.fields, { kind: 'other' })).sort()).toEqual(['cost', 'detail']);
        expect(pruneHidden(doc.fields, { kind: 'x', detail: 'gone', cost: 4 })).toEqual({ kind: 'x' });
        expect(pruneHidden(doc.fields, { kind: 'other', detail: 'kept', cost: 4 })).toEqual({
            kind: 'other',
            detail: 'kept',
            cost: 4
        });
    });

    it('validates rows of a repeatable section with paths per row', () => {
        const doc = readDocument([
            field('FormArray', 'lines', { props: { minItems: 1, maxItems: 2 } }),
            req(field('InputText', 'what', { parentId: 'lines' })),
            req(field('InputNumber', 'qty', { parentId: 'lines' }))
        ]);
        const init = initialValues(doc.fields);
        expect(init).toEqual({ lines: [{}] }); // minItems blank rows; a blank number box holds no value
        expect(validateForm(doc.fields, { lines: [] })).toEqual({ lines: 'lines: at least 1 row required' });
        expect(validateForm(doc.fields, { lines: [{}, {}, {}] })).toEqual({ lines: 'lines: at most 2 rows allowed' });
        expect(validateForm(doc.fields, { lines: [{ what: 'pen', qty: 2 }, { what: '' }] })).toEqual({
            'lines[1].what': 'This field is required',
            'lines[1].qty': 'This field is required'
        });
    });

    it('applies type rules and editor rules', () => {
        const doc = readDocument([
            field('InputText', 'email', { props: { type: 'email' } }),
            field('InputText', 'code', {
                validation: { rules: { pattern: '^[A-Z]{3}$', patternMessage: 'Three capitals' } }
            }),
            field('InputNumber', 'n', { validation: { rules: { min: 1, max: 9 } } }),
            req(field('Checkbox', 'agree')),
            req(field('MultiSelect', 'tags')),
            field('Calendar', 'when', { props: { minDate: '2026-01-01' } }),
            field('FileUpload', 'doc', { props: { accept: '.pdf', maxFileSize: 100 } })
        ]);
        const errors = validateForm(doc.fields, {
            email: 'nope',
            code: 'abc',
            n: 12,
            agree: false,
            tags: '',
            when: '2025-12-31',
            doc: [{ name: 'a.png', size: 5, type: 'image/png' }]
        });
        expect(errors).toEqual({
            email: 'Please enter a valid email address',
            code: 'Three capitals',
            n: 'Cannot be more than 9',
            agree: 'This field is required',
            tags: 'This field is required',
            when: 'Date is too early',
            doc: 'Invalid file type'
        });
        expect(
            validateForm(doc.fields, {
                email: '',
                code: '',
                n: undefined,
                agree: true,
                tags: ['x'],
                when: '2026-02-01',
                doc: []
            })
        ).toEqual({});
    });

    it('skips fields whose palette entry opted out of validation', () => {
        const doc = readDocument([{ ...req(field('InputText', 'a')), behavior: { validation: { supported: false } } }]);
        expect(validateForm(doc.fields, {})).toEqual({});
    });
});
