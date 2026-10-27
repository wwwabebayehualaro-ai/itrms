// @vitest-environment node
// Form test cases (task 0.18a): run through the server's rules, no database.
import { describe, expect, it } from 'vitest';

import { checkDocument, mismatchText, runTestCases, TEST_USER_ID } from './';

const F = (id: string, type = 'InputText', extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: { am: id, en: id },
    props: {},
    ...extra
});
const V = (extra: Record<string, unknown> = {}) => ({ validation: { supported: true, ...extra } });
const required = { props: { required: true }, behavior: V() };
const kase = (
    id: string,
    values: Record<string, unknown>,
    expect: Record<string, unknown>,
    extra: Record<string, unknown> = {}
) => ({ id, name: `case ${id}`, values, expect, ...extra });
const form = (testCases: unknown[], fields: Record<string, unknown>[] = [F('name', 'InputText', required)]) => ({
    textLanguage: 'en',
    fields,
    testCases
});

describe('runTestCases', () => {
    it('passes a case that expects the outcome the form gives', () => {
        const results = runTestCases(
            form([
                kase('ok', { name: 'Abebe' }, { valid: true, values: { name: 'Abebe' } }),
                kase('empty', {}, { valid: false, errors: { name: true } })
            ])
        );
        expect(results).toEqual([
            { id: 'ok', name: 'case ok', passed: true, mismatches: [] },
            { id: 'empty', name: 'case empty', passed: true, mismatches: [] }
        ]);
    });

    it('fails with the path, expected and actual when the outcome differs', () => {
        const [result] = runTestCases(form([kase('bad', {}, { valid: true })]));
        expect(result?.passed).toBe(false);
        const mismatch = result?.mismatches[0];
        expect(mismatch).toMatchObject({ path: 'valid', expected: true, actual: false });
        if (mismatch) expect(mismatchText('en', mismatch)).toContain('refuses');
    });

    it('compares the set of failing paths and a message when it is written', () => {
        const fields = [
            F('name', 'InputText', required),
            F('age', 'InputNumber', { props: { required: true }, behavior: V() })
        ];
        const results = runTestCases(
            form(
                [
                    kase('same', {}, { valid: false, errors: { name: true, age: true } }),
                    kase('missing', { age: 3 }, { valid: false, errors: { name: true, age: true } }),
                    kase('extra', {}, { valid: false, errors: { name: true } }),
                    kase('message', {}, { valid: false, errors: { name: 'Nope', age: true } }),
                    kase('exact', {}, { valid: false, errors: { name: 'This field is required', age: true } })
                ],
                fields
            )
        );
        expect(results.map((r) => [r.id, r.passed])).toEqual([
            ['same', true],
            ['missing', false],
            ['extra', false],
            ['message', false],
            ['exact', true]
        ]);
        expect(results[1]?.mismatches.map((m) => m.path)).toEqual(['errors.age']);
        expect(results[2]?.mismatches.map((m) => m.path)).toEqual(['errors.age']);
        expect(results[3]?.mismatches[0]).toMatchObject({ path: 'errors.name', expected: 'Nope' });
    });

    it('checks submitted values: hidden and removed fields are pruned, computed ones settled', () => {
        const fields = [
            F('qty', 'InputNumber'),
            F('total', 'InputNumber', { data: { computed: { expression: '{{= form.qty * 2}}', readOnly: true } } }),
            F('hidden', 'InputText', {
                behavior: { visibilityConditions: [{ field: 'qty', operator: 'gt', value: 100 }] }
            }),
            F('old', 'InputText', { removed: true })
        ];
        const results = runTestCases(
            form(
                [
                    kase('prune', { qty: 2, hidden: 'x', old: 'y' }, { valid: true, values: { qty: 2, total: 4 } }),
                    kase('hidden-gone', { qty: 2, hidden: 'x' }, { valid: true, values: { hidden: 'x' } }),
                    kase('old-gone', { old: 'y' }, { valid: true, values: { old: 'y' } })
                ],
                fields
            )
        );
        expect(results.map((r) => r.passed)).toEqual([true, false, false]);
        expect(results[1]?.mismatches[0]).toMatchObject({ path: 'values.hidden', expected: 'x', actual: undefined });
    });

    it('reaches values inside rows with a path', () => {
        const fields = [F('rows', 'FormArray'), F('qty', 'InputNumber', { parentId: 'rows' })];
        const values = { rows: [{ qty: 1 }, { qty: 2 }] };
        const [result] = runTestCases(
            form([kase('rows', values, { valid: true, values: { 'rows[1].qty': 2 } })], fields)
        );
        expect(result?.passed).toBe(true);
    });

    it('applies the roles of the case: a field for other roles is not asked', () => {
        const fields = [F('name', 'InputText', { ...required, visibleToRoles: ['clerk'] })];
        const results = runTestCases(
            form(
                [
                    kase('other', {}, { valid: true }),
                    kase('clerk', {}, { valid: false, errors: { name: true } }, { roles: ['clerk'] })
                ],
                fields
            )
        );
        expect(results.map((r) => r.passed)).toEqual([true, true]);
    });

    it('lets a rule read the test user and the roles', () => {
        const expression = `user.id == "${TEST_USER_ID}" && count(user.roles) == 1`;
        const fields = [
            F('name', 'InputText', { behavior: V({ validWhen: [{ expression, message: { en: 'bad' } }] }) })
        ];
        const results = runTestCases(
            form(
                [
                    kase('with', { name: 'x' }, { valid: true }, { roles: ['clerk'] }),
                    kase('without', { name: 'x' }, { valid: false, errors: { name: 'bad' } })
                ],
                fields
            )
        );
        expect(results.map((r) => r.passed)).toEqual([true, true]);
    });

    it('uses the language of the case for the engine messages', () => {
        const [result] = runTestCases(
            form([kase('am', {}, { valid: false, errors: { name: 'This field is required' } }, { language: 'am' })])
        );
        expect(result?.passed).toBe(false);
    });

    it('checks lookups by shape only', () => {
        const fields = [F('who', 'RegistryLookup', { props: { provider: 'persons' } })];
        const results = runTestCases(
            form(
                [
                    kase('id', { who: '0b5c0f4e-7a6d-4f4e-9a3b-1c2d3e4f5a6b' }, { valid: true }),
                    kase('junk', { who: 'abc' }, { valid: false, errors: { who: true } })
                ],
                fields
            )
        );
        expect(results.map((r) => r.passed)).toEqual([true, true]);
    });

    it('fails a case that is not a valid case, and gives nothing for a form with none', () => {
        const [result] = runTestCases(form([{ id: 'Bad Id', name: 'x', values: {}, expect: { valid: true } }]));
        expect(result).toMatchObject({ id: 'Bad Id', passed: false });
        expect(result?.mismatches[0]?.message).toBe('form-engine.core.tests.invalidCase');
        expect(runTestCases({ fields: [] })).toEqual([]);
        expect(runTestCases([])).toEqual([]);
    });
});

describe('test cases in the contract', () => {
    const problems = (testCases: unknown[]) => checkDocument(form(testCases)).map((p) => p.path);
    const ok = kase('a', {}, { valid: true });

    it('accepts sound cases', () => {
        expect(problems([ok, kase('b-2', {}, { valid: false, errors: { name: true } })])).toEqual([]);
    });

    it('refuses a valid case with errors, a bad id, an empty name and more than 50 cases', () => {
        expect(problems([kase('a', {}, { valid: true, errors: {} })])).toEqual(['testCases[0].expect.errors']);
        expect(problems([kase('A_', {}, { valid: true })])).toEqual(['testCases[0].id']);
        expect(problems([{ ...ok, name: '' }])).toEqual(['testCases[0].name']);
        const many = Array.from({ length: 51 }, (_, i) => kase(`c${i}`, {}, { valid: true }));
        expect(problems(many)).toEqual(['testCases']);
    });

    it('reports a duplicate case id', () => {
        expect(problems([ok, kase('b', {}, { valid: true }), kase('a', {}, { valid: true })])).toEqual([
            'testCases[2].id'
        ]);
    });
});
