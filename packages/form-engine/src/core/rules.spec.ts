// @vitest-environment node
// Rules written as formulas (task 0.17b): requiredWhen, validWhen, the Ethiopian date field, computed fields that chain.
import { describe, expect, it } from 'vitest';

import {
    checkDocument,
    checkRuleFormula,
    ethiopianDateText,
    evalCondition,
    isIsoDay,
    isRequiredIn,
    readDocument,
    settledValues,
    validateForm as validate
} from './';
import { evalFormula } from './runtime/formula';

// these cases are written with the engine's English messages
const validateForm = (...[fields, values, scope]: Parameters<typeof validate>) =>
    validate(fields, values, scope, { language: 'en' });

const V = (extra: Record<string, unknown> = {}) => ({ supported: true, ...extra });
const F = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, props: {}, ...extra });
const doc = (...fields: Record<string, unknown>[]) => readDocument({ fields }).fields;

describe('evalCondition', () => {
    it('uses the language truthiness: a list is true, null, empty text, 0 and false are not', () => {
        expect(evalCondition('form.a', { form: { a: [] } })).toBe(true);
        expect(evalCondition('form.a', { form: { a: [1] } })).toBe(true);
        expect(evalCondition('form.a', { form: { a: null } })).toBe(false);
        expect(evalCondition('form.a', { form: {} })).toBe(false);
        expect(evalCondition('form.a', { form: { a: '' } })).toBe(false);
        expect(evalCondition('form.a', { form: { a: 0 } })).toBe(false);
        expect(evalCondition('form.a', { form: { a: false } })).toBe(false);
        expect(evalCondition('form.a', { form: { a: 'x' } })).toBe(true);
    });

    it('gives undefined for a formula that cannot run (bad syntax, unknown function)', () => {
        expect(evalCondition('form.a >', { form: {} })).toBeUndefined();
        expect(evalCondition('nope(form.a)', { form: {} })).toBeUndefined();
    });
});

describe('days()', () => {
    const days = (a: unknown, b: unknown) => evalFormula('days(a, b)', { a, b });
    it('counts whole days from a to b, signed, over month and leap-year ends', () => {
        expect(days('2026-09-01', '2026-09-11')).toBe(10);
        expect(days('2026-09-11', '2026-09-01')).toBe(-10);
        expect(days('2026-02-28', '2026-03-01')).toBe(1);
        expect(days('2028-02-28', '2028-03-01')).toBe(2);
        expect(days('2026-05-05', '2026-05-05')).toBe(0);
        expect(days('2025-12-31', '2026-01-01')).toBe(1);
    });
    it('reads an instant on its Addis Ababa day (UTC+3)', () => {
        // 23:59 and 00:01 in Addis Ababa, across its midnight (20:59 and 21:01 UTC)
        expect(days('2026-09-01T20:59:00Z', '2026-09-01T21:01:00Z')).toBe(1);
        // 01:30 in Addis Ababa on the 25th is the 24th in UTC: it counts on the 25th
        expect(days('2026-10-25', '2026-10-24T22:30:00Z')).toBe(0);
        expect(days('2026-09-01', '2026-09-03T10:00:00+03:00')).toBe(2);
    });
    it('gives null when either is not a real date', () => {
        for (const bad of [undefined, null, '', 'x', '2026-02-30', '2026-13-01', 5, '09/01/2026', {}])
            expect(days(bad, '2026-01-01'), JSON.stringify(bad) ?? 'undefined').toBeNull();
        expect(days('2026-01-01', '2026-02-30')).toBeNull();
    });
});

describe('rule formulas in a stored form', () => {
    it('ignores a formula that errors or calls an unknown function when the form runs', () => {
        const fields = doc(
            F('a', 'InputText', {
                behavior: {
                    validation: V({
                        requiredWhen: { expression: 'bogus(form.b)' },
                        validWhen: [{ expression: 'form.b >' }]
                    })
                }
            }),
            F('b', 'InputText', { behavior: { validation: V() } })
        );
        expect(validateForm(fields, { a: 'x', b: '' })).toEqual({});
        expect(validateForm(fields, { b: '' })).toEqual({});
    });

    it('is refused by checkDocument, naming the formula', () => {
        const bad = {
            fields: [
                F('a', 'InputText', {
                    behavior: {
                        validation: V({
                            requiredWhen: { expression: 'bogus(form.b)' },
                            validWhen: [
                                { expression: 'form.b > 1' },
                                { expression: 'data.x == 1' },
                                { expression: 'qty > 1' }
                            ]
                        })
                    }
                }),
                F('b', 'InputText')
            ]
        };
        const found = Object.fromEntries(checkDocument(bad).map((p) => [p.path, p.message]));
        expect(found['fields[0].behavior.validation.requiredWhen.expression']).toMatch(/Unknown function "bogus"/);
        expect(found['fields[0].behavior.validation.validWhen[0].expression']).toBeUndefined();
        expect(found['fields[0].behavior.validation.validWhen[1].expression']).toMatch(/Data sources/);
        expect(found['fields[0].behavior.validation.validWhen[2].expression']).toMatch(/form\.qty/);
    });

    it('refuses a formula over 500 characters and more than 10 validWhen rules when saved', () => {
        const long = 'form.a == 1' + ' || form.a == 1'.repeat(40);
        const many = Array.from({ length: 11 }, () => ({ expression: 'true' }));
        const found = Object.fromEntries(
            checkDocument({
                fields: [
                    F('a', 'InputText', { behavior: { validation: V({ requiredWhen: { expression: long } }) } }),
                    F('b', 'InputText', { behavior: { validation: V({ validWhen: many }) } })
                ]
            }).map((p) => [p.path, p.message])
        );
        expect(found['fields[0].behavior.validation.requiredWhen.expression']).toMatch(/500/);
        expect(found['fields[1].behavior.validation.validWhen']).toMatch(/10/);
    });
});

describe('checkRuleFormula', () => {
    it('lets a rule read form, row, root, user.id and user.roles', () => {
        for (const ok of [
            'form.qty > 1',
            'row.qty > 1',
            'root.items[0].qty',
            "user.roles == 'x'",
            'user.id',
            'count(root.items) > 0'
        ])
            expect(checkRuleFormula(ok), ok).toBeNull();
    });
    it('refuses data sources, other roots and bare names, saying what to write', () => {
        expect(checkRuleFormula('data.x == 1')).toMatch(/data sources are not available/i);
        expect(checkRuleFormula('qty > 1')).toMatch(/form\.qty/);
        expect(checkRuleFormula('user.name')).toMatch(/user\.id and user\.roles/);
        expect(checkRuleFormula('route.id')).toMatch(/not available/);
        expect(checkRuleFormula('form')).toMatch(/needs a field/);
        expect(checkRuleFormula('nope(1)')).toMatch(/Unknown function/);
        expect(checkRuleFormula('1 +')).not.toBeNull();
    });
});

describe('requiredWhen and validWhen', () => {
    const fields = doc(
        F('kind', 'InputText', { behavior: { validation: V() } }),
        F('doc', 'InputText', {
            behavior: { validation: V({ requiredWhen: { expression: "form.kind == 'other'" } }) }
        }),
        F('n', 'InputNumber', {
            behavior: {
                validation: V({
                    validWhen: [{ expression: 'form.n > 5', message: 'Over five' }, { expression: 'form.n < 9' }]
                })
            }
        })
    );
    it('isRequiredIn reads the scope like a computed field', () => {
        const f = fields[1];
        if (!f) throw new Error('no field');
        expect(isRequiredIn(f, { kind: 'other' }, { kind: 'other' })).toBe(true);
        expect(isRequiredIn(f, { kind: 'x' }, { kind: 'x' })).toBe(false);
        expect(f.rules.requiredWhen).toBe("form.kind == 'other'");
    });
    it('takes the first failing validWhen message, then the default, and skips a blank value', () => {
        expect(validateForm(fields, { n: 3 })).toEqual({ n: 'Over five' });
        expect(validateForm(fields, { n: 12 })).toEqual({ n: 'This value is not valid' });
        expect(validateForm(fields, { n: 7 })).toEqual({});
        expect(validateForm(fields, {})).toEqual({});
    });
    it('requires a section to have a row when its formula holds', () => {
        const section = doc(
            F('kind', 'InputText'),
            F('items', 'FormArray', {
                category: 'Layout',
                layout: { options: { isContainer: true } },
                behavior: {
                    validation: V({
                        requiredWhen: { expression: "form.kind == 'other'" },
                        errorMessages: { required: 'Add a row' }
                    })
                }
            })
        );
        expect(validateForm(section, { kind: 'other', items: [] })).toEqual({ items: 'Add a row' });
        expect(validateForm(section, { kind: 'other', items: [{}] })).toEqual({});
        expect(validateForm(section, { kind: 'x', items: [] })).toEqual({});
    });
    it('reads a hidden field as absent, in the browser and on the server alike', () => {
        const f = doc(
            F('a', 'InputText', { behavior: { visibilityConditions: [{ field: 'k', operator: 'eq', value: 1 }] } }),
            F('k', 'InputNumber'),
            F('b', 'InputText', {
                behavior: { validation: V({ validWhen: [{ expression: "form.a == ''", message: 'a must be empty' }] }) }
            })
        );
        expect(validateForm(f, { k: 2, a: 'x', b: 'y' })).toEqual({});
    });
});

describe('the EthDate field', () => {
    const f = doc(
        F('d', 'EthDate', {
            props: { minDate: '2026-09-11', maxDate: '2026-10-11' },
            behavior: { validation: V({ errorMessages: { minDate: 'Not before {min}', maxDate: 'Not after {max}' } }) }
        })
    );
    it('accepts a real Gregorian day and refuses one that rolls over', () => {
        expect(validateForm(f, { d: '2026-09-11' })).toEqual({});
        expect(validateForm(f, { d: '2026-02-30' })).toEqual({ d: 'Please enter a valid date' });
        expect(validateForm(f, { d: '2026-9-11' })).toEqual({ d: 'Please enter a valid date' });
        expect(validateForm(f, { d: 'x' })).toEqual({ d: 'Please enter a valid date' });
    });
    it('words the limits as Ethiopian dates', () => {
        expect(validateForm(f, { d: '2026-09-10' })).toEqual({ d: 'Not before 01/01/2019' });
        expect(validateForm(f, { d: '2026-10-12' })).toEqual({ d: 'Not after 01/02/2019' });
    });
    it('is checked for its shape even when it has no rules', () => {
        const bare = doc(F('d', 'EthDate'));
        expect(validateForm(bare, { d: '2026-02-30' })).toEqual({ d: 'Please enter a valid date' });
        expect(validateForm(bare, { d: '2026-09-11' })).toEqual({});
    });
    it('isIsoDay and ethiopianDateText', () => {
        expect(isIsoDay('2028-02-29')).toBe(true);
        expect(isIsoDay('2026-02-29')).toBe(false);
        expect(isIsoDay('2026-02-28T00:00:00Z')).toBe(false);
        expect(ethiopianDateText('2026-09-11')).toBe('01/01/2019');
        expect(ethiopianDateText('2026-09-11', { long: true, language: 'en' })).toMatch(/Meskerem/);
        expect(ethiopianDateText('2026-09-11', { long: true, language: 'xx' })).toBe(
            ethiopianDateText('2026-09-11', { long: true })
        );
        expect(ethiopianDateText('2026-02-30')).toBe('');
    });
});

describe('settledValues chains of computed fields', () => {
    const computed = (id: string, expression: string, extra: Record<string, unknown> = {}) =>
        F(id, 'InputNumber', { data: { computed: { expression, readOnly: true } }, ...extra });

    it('settles a field that reads a computed field stored after it', () => {
        const fields = doc(
            F('qty', 'InputNumber'),
            computed('quad', '{{= form.double * 2 }}'),
            computed('double', '{{= form.qty * 2 }}')
        );
        expect(settledValues(fields, { qty: 3 })).toEqual({ qty: 3, quad: 12, double: 6 });
    });
    it('lets a total read settled rows and a row read the settled root', () => {
        const fields = doc(
            F('lines', 'FormArray', { category: 'Layout', layout: { options: { isContainer: true } } }),
            F('qty', 'InputNumber', { parentId: 'lines' }),
            computed('line', '{{= row.qty * root.rate }}', { parentId: 'lines' }),
            computed('rate', '{{= 10 }}'),
            computed('total', "{{= sum(root.lines, 'line') }}")
        );
        expect(settledValues(fields, { lines: [{ qty: 1 }, { qty: 2 }] })).toEqual({
            lines: [
                { qty: 1, line: 10 },
                { qty: 2, line: 20 }
            ],
            rate: 10,
            total: 30
        });
    });
    it('stops a cycle at the cap, the same way every time', () => {
        const fields = doc(computed('a', '{{= form.b + 1 }}'), computed('b', '{{= form.a + 1 }}'));
        const first = settledValues(fields, {});
        expect(settledValues(fields, {})).toEqual(first);
        // two computed fields: 3 passes, a then b each pass
        expect(first).toEqual({ a: 5, b: 6 });
    });
    it('keeps the value of an editable computed field', () => {
        const fields = doc(
            F('qty', 'InputNumber'),
            F('t', 'InputNumber', { data: { computed: { expression: '{{= form.qty }}' } } })
        );
        expect(settledValues(fields, { qty: 3, t: 99 })).toEqual({ qty: 3, t: 99 });
    });
});

describe('review findings of task 0.17b', () => {
    const row = (id: string, type: string, extra: Record<string, unknown> = {}) =>
        F(id, type, { parentId: 'lines', ...extra });
    const section = (validation: Record<string, unknown>, props: Record<string, unknown> = {}) =>
        F('lines', 'FormArray', {
            props,
            layout: { options: { isContainer: true } },
            behavior: { validation: V(validation) }
        });

    it('takes an untouched range slider (its scalar default) and a picked range, not another shape', () => {
        const fields = doc(F('span', 'Slider', { props: { range: true } }));
        expect(validateForm(fields, { span: 0 })).toEqual({});
        expect(validateForm(fields, { span: [10, 40] })).toEqual({});
        expect(validateForm(fields, { span: 'x' })).toHaveProperty('span');
    });

    it("checks a section's own rules over its rows, and Required needs a row", () => {
        const fields = doc(
            section({ validWhen: [{ expression: 'count(form.lines) <= 2', message: 'At most two lines' }] }),
            row('what', 'InputText')
        );
        expect(validateForm(fields, { lines: [{ what: 'a' }, { what: 'b' }] })).toEqual({});
        expect(validateForm(fields, { lines: [{ what: 'a' }, { what: 'b' }, { what: 'c' }] })).toEqual({
            lines: 'At most two lines'
        });
        const required = doc(section({}, { required: true }), row('what', 'InputText'));
        expect(validateForm(required, { lines: [] })).toHaveProperty('lines');
    });

    it('refuses more rows than the cap, and keeps no more than one past it', () => {
        const fields = doc(section({}), row('what', 'InputText'));
        const many = { lines: Array.from({ length: 5000 }, () => ({ what: 'x' })) };
        expect(validateForm(fields, many).lines).toMatch(/at most 1000 rows/);
    });

    it('prunes a field shown only by a hidden field (a chain), the same on both sides', () => {
        const fields = doc(
            F('c', 'InputText'),
            F('a', 'InputText', { behavior: { visibilityConditions: [{ field: 'c', operator: 'eq', value: 'yes' }] } }),
            F('b', 'InputText', { behavior: { visibilityConditions: [{ field: 'a', operator: 'eq', value: 'x' }] } })
        );
        // C says "no": A is hidden, so B (shown only when A is "x") is hidden too, and its odd value is not taken
        expect(validateForm(fields, { c: 'no', a: 'x', b: { any: 'object' } })).toEqual({});
    });

    it('refuses a subtraction written without spaces (it would read a field that cannot exist)', () => {
        expect(checkRuleFormula('form.total-form.paid >= 0')).toMatch(/spaces around "-"/);
        expect(checkRuleFormula('form.total - form.paid >= 0')).toBeNull();
    });
});
