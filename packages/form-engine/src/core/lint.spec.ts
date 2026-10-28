// @vitest-environment node
// The form lint (task 0.18a): every rule has a case that fires and one that does not; removed fields are never a subject.
import { describe, expect, it } from 'vitest';

import { engineText, lintDocument, type LintProblem } from './';

// classified, as a sound form's fields are (the unclassified rule has its own tests)
const F = (id: string, type = 'InputText', extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: { am: id, en: id },
    props: {},
    classification: 'personal',
    ...extra
});
const panel = (id: string, extra: Record<string, unknown> = {}) =>
    F(id, 'Panel', { category: 'Layout', layout: { options: { isContainer: true } }, ...extra });
const show = (...conditions: Record<string, unknown>[]) => ({ behavior: { visibilityConditions: conditions } });
const doc = (fields: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ fields, ...extra });
const ofRule = (problems: LintProblem[], rule: string) => problems.filter((p) => p.rule === rule);
const choice = F('office', 'Dropdown', {
    props: {
        options: [
            { label: { am: 'ከተማ', en: 'Town' }, value: 'town' },
            { label: { am: 'ወረዳ', en: 'Woreda' }, value: 'woreda' }
        ]
    }
});

describe('lintDocument', () => {
    it('finds nothing wrong with a sound form', () => {
        const fields = [
            F('name'),
            choice,
            F('town', 'InputText', show({ field: 'office', operator: 'eq', value: 'town' }))
        ];
        expect(lintDocument(doc(fields))).toEqual([]);
    });

    it('gives the messages in the catalogue, errors first', () => {
        const problems = lintDocument(
            doc([
                F('a', 'InputText', { label: 'only plain' }),
                F('b', 'InputText', show({ field: 'zzz', operator: 'notEmpty' }))
            ])
        );
        expect(problems.map((p) => p.severity)).toEqual(['error', 'warning']);
        const first = problems[0];
        expect(engineText('en', first?.message ?? 'form-engine.core.lint.unreachable', first?.values)).toContain(
            '"zzz"'
        );
    });

    describe('unclassified', () => {
        it('warns of a field that holds an answer and has no data class, and only of it', () => {
            const problems = lintDocument(
                doc([
                    F('phone', 'InputText', { classification: undefined }),
                    F('fin', 'InputText', { classification: 'sensitive' }),
                    panel('box', { classification: undefined })
                ])
            );
            expect(ofRule(problems, 'unclassified')).toEqual([
                expect.objectContaining({ severity: 'warning', fieldId: 'phone', path: 'fields[0].classification' })
            ]);
            expect(engineText('en', 'form-engine.core.lint.unclassified', { field: 'phone' })).toContain(
                'the browser keeps no draft'
            );
        });
    });

    describe('sensitive-filterable', () => {
        it('refuses a Sensitive field marked filterable (task 0.20d)', () => {
            const problems = lintDocument(
                doc([F('fin', 'InputText', { classification: 'sensitive', filterable: true })])
            );
            expect(ofRule(problems, 'sensitive-filterable')).toEqual([
                expect.objectContaining({ severity: 'error', fieldId: 'fin', path: 'fields[0].filterable' })
            ]);
        });
    });

    describe('unknown-reference', () => {
        it('fires for a condition, a computed field, requiredWhen and validWhen that name no field', () => {
            const problems = lintDocument(
                doc([
                    F('a'),
                    F('b', 'InputText', show({ field: 'nope', operator: 'notEmpty' })),
                    F('c', 'InputNumber', { data: { computed: { expression: '{{= form.ghost * 2}}' } } }),
                    F('d', 'InputText', {
                        behavior: {
                            validation: {
                                supported: true,
                                requiredWhen: { expression: 'row.phantom == 1' },
                                validWhen: [{ expression: 'root.spectre > 1' }]
                            }
                        }
                    })
                ])
            );
            const found = ofRule(problems, 'unknown-reference');
            expect(found.map((p) => [p.fieldId, p.values?.ref])).toEqual([
                ['b', 'nope'],
                ['c', 'form.ghost'],
                ['d', 'row.phantom'],
                ['d', 'root.spectre']
            ]);
            expect(found.every((p) => p.severity === 'error')).toBe(true);
        });

        it('lets fields, scope roots and a removed field pass', () => {
            const problems = lintDocument(
                doc([
                    F('a'),
                    F('gone', 'InputText', { removed: true }),
                    F(
                        'b',
                        'InputText',
                        show(
                            { field: 'form.a', operator: 'notEmpty' },
                            { field: 'user.role', operator: 'notEmpty' },
                            { field: 'data.x', operator: 'notEmpty' }
                        )
                    ),
                    F('c', 'InputText', show({ field: 'gone', operator: 'empty' }))
                ])
            );
            expect(ofRule(problems, 'unknown-reference')).toEqual([]);
        });
    });

    describe('unreachable', () => {
        it('fires for two different equalities, an equality with empty, and a condition on a removed field', () => {
            const problems = lintDocument(
                doc([
                    F('x'),
                    F('gone', 'InputText', { removed: true }),
                    F(
                        'p',
                        'InputText',
                        show({ field: 'x', operator: 'eq', value: 'a' }, { field: 'x', operator: 'eq', value: 'b' })
                    ),
                    F(
                        'q',
                        'InputText',
                        show({ field: 'x', operator: 'eq', value: 'a' }, { field: 'x', operator: 'empty' })
                    ),
                    F('r', 'InputText', show({ field: 'gone', operator: 'eq', value: 'a' })),
                    F(
                        's',
                        'InputText',
                        show({ field: 'gone', operator: 'notEmpty', logic: 'or' }, { field: 'x', operator: 'empty' })
                    )
                ])
            );
            expect(ofRule(problems, 'unreachable').map((p) => p.fieldId)).toEqual(['p', 'q', 'r']);
        });

        it('fires for an or-list only when every condition is dead', () => {
            const gone = F('gone', 'InputText', { removed: true });
            const dead = { field: 'gone', operator: 'gt', value: 3, logic: 'or' };
            const live = { field: 'x', operator: 'notEmpty' };
            const both = lintDocument(
                doc([F('x'), gone, F('p', 'InputText', show(dead, { field: 'gone', operator: 'notEmpty' }))])
            );
            const mixed = lintDocument(doc([F('x'), gone, F('p', 'InputText', show(dead, live))]));
            expect(ofRule(both, 'unreachable')).toHaveLength(1);
            expect(ofRule(mixed, 'unreachable')).toEqual([]);
        });

        it('does not fire for a binding, the same value twice, or a removed field read as empty', () => {
            const problems = lintDocument(
                doc([
                    F('x'),
                    F('gone', 'InputText', { removed: true }),
                    F(
                        'p',
                        'InputText',
                        show({ field: 'x', operator: 'eq', value: 'a' }, { field: 'x', operator: 'eq', value: 'a' })
                    ),
                    F(
                        'q',
                        'InputText',
                        show(
                            { field: 'x', operator: 'eq', value: '{{form.y}}' },
                            { field: 'x', operator: 'eq', value: 'b' }
                        )
                    ),
                    F('r', 'InputText', show({ field: 'gone', operator: 'empty' })),
                    F(
                        's',
                        'InputText',
                        show({ field: 'x', operator: 'eq', value: '' }, { field: 'x', operator: 'empty' })
                    )
                ])
            );
            expect(ofRule(problems, 'unreachable')).toEqual([]);
        });
    });

    describe('cycle', () => {
        it('reports a loop once, with its path', () => {
            const problems = lintDocument(
                doc([
                    F('a', 'InputNumber', { data: { computed: { expression: '{{= form.b + 1}}' } } }),
                    F('b', 'InputNumber', { data: { computed: { expression: '{{= form.a + 1}}' } } })
                ])
            );
            const cycles = ofRule(problems, 'cycle');
            expect(cycles).toHaveLength(1);
            expect(cycles[0]?.values?.path).toBe('a → b → a');
            expect(cycles[0]?.severity).toBe('error');
        });

        it('sees a field that reads itself, and a loop through visibility', () => {
            const self = lintDocument(doc([F('a', 'InputText', show({ field: 'a', operator: 'notEmpty' }))]));
            const through = lintDocument(
                doc([
                    F('a', 'InputText', show({ field: 'b', operator: 'notEmpty' })),
                    F('b', 'InputText', show({ field: 'a', operator: 'notEmpty' }))
                ])
            );
            expect(ofRule(self, 'cycle')[0]?.values?.path).toBe('a → a');
            expect(ofRule(through, 'cycle')).toHaveLength(1);
        });

        it('does not count requiredWhen or validWhen, a chain, or a removed field', () => {
            const problems = lintDocument(
                doc([
                    F('a', 'InputNumber', { data: { computed: { expression: '{{= form.b + 1}}' } } }),
                    F('b', 'InputNumber', {
                        behavior: { validation: { supported: true, requiredWhen: { expression: 'form.a > 1' } } }
                    }),
                    F('c', 'InputNumber', { removed: true, data: { computed: { expression: '{{= form.d}}' } } }),
                    F('d', 'InputNumber', { data: { computed: { expression: '{{= form.c}}' } } })
                ])
            );
            expect(ofRule(problems, 'cycle')).toEqual([]);
        });
    });

    describe('duplicate-option', () => {
        const withOptions = (options: unknown[], where: 'props' | 'static' = 'props') =>
            F(
                'o',
                'Dropdown',
                where === 'props' ? { props: { options } } : { data: { dataSource: { staticData: options } } }
            );
        const count = (field: Record<string, unknown>) => ofRule(lintDocument(doc([field])), 'duplicate-option');

        it('fires for equal values, nested ones too', () => {
            expect(count(withOptions([{ value: 'a' }, { value: 'b' }, { value: 'a' }]))).toHaveLength(1);
            expect(
                count(withOptions([{ value: 'a' }, { label: 'g', items: [{ value: 'a' }] }], 'static'))
            ).toHaveLength(1);
            expect(count(withOptions([1, '1', 1]))).toHaveLength(1);
        });

        it('does not fire for distinct values (1 and "1" differ), or for a removed field', () => {
            expect(count(withOptions([1, '1', { value: 2 }]))).toEqual([]);
            expect(count({ ...withOptions([{ value: 'a' }, { value: 'a' }]), removed: true })).toEqual([]);
        });
    });

    describe('too-many-fields', () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => F(`f${i}`));
        it('fires above the limit and not at it', () => {
            expect(ofRule(lintDocument(doc(many(4)), { maxFields: 3 }), 'too-many-fields')).toHaveLength(1);
            expect(ofRule(lintDocument(doc(many(3)), { maxFields: 3 }), 'too-many-fields')).toEqual([]);
        });
        it('counts 300 by default and leaves removed fields out', () => {
            expect(ofRule(lintDocument(doc(many(301))), 'too-many-fields')).toHaveLength(1);
            expect(ofRule(lintDocument(doc(many(300))), 'too-many-fields')).toEqual([]);
            const withRemoved = [...many(300), F('old', 'InputText', { removed: true })];
            expect(ofRule(lintDocument(doc(withRemoved)), 'too-many-fields')).toEqual([]);
        });
    });

    describe('data sources', () => {
        const withSource = (url: string, method = 'GET') =>
            doc([], { runtime: { dataSources: [{ id: 'ds', request: { method, url } }], variables: [] } });
        const allow = [{ method: 'GET', path: 'v1/registry-lookups/' }];

        it('errors on an absolute, protocol-relative or ".." address', () => {
            for (const url of [
                'https://evil.example/x',
                '//evil.example/x',
                'v1/../admin',
                '/api/v1/registry-lookups/../x'
            ])
                expect(ofRule(lintDocument(withSource(url), { dataSources: allow }), 'data-source'), url).toHaveLength(
                    1
                );
        });

        it('warns (does not error) on a path outside the allow-list, or another method', () => {
            const other = lintDocument(withSource('v1/forms'), { dataSources: allow });
            expect(ofRule(other, 'data-source')).toEqual([]);
            expect(ofRule(other, 'data-source-unlisted')).toHaveLength(1);
            expect(ofRule(other, 'data-source-unlisted')[0]?.severity).toBe('warning');
            const post = lintDocument(withSource('v1/registry-lookups/persons', 'POST'), { dataSources: allow });
            expect(ofRule(post, 'data-source-unlisted')).toHaveLength(1);
        });

        it('accepts listed paths: a leading slash, api/, a query, placeholders', () => {
            for (const url of [
                'v1/registry-lookups/persons',
                '/v1/registry-lookups/persons',
                '/api/v1/registry-lookups/persons?q={{form.name}}',
                'api/v1/registry-lookups/{provider}/search?x=1'
            ])
                expect(lintDocument(withSource(url), { dataSources: allow }), url).toEqual([]);
        });

        it('skips the allow-list part when none is given', () => {
            expect(ofRule(lintDocument(withSource('v1/anything')), 'data-source-unlisted')).toEqual([]);
        });
    });

    describe('untranslated', () => {
        it('warns once per field and only for a missing required language', () => {
            const problems = lintDocument(
                doc([F('a', 'InputText', { label: { am: 'ስም' }, props: { helpText: { am: 'እገዛ' } } }), F('b')])
            );
            const found = ofRule(problems, 'untranslated');
            expect(found).toHaveLength(1);
            expect(found[0]).toMatchObject({
                severity: 'warning',
                fieldId: 'a',
                values: { count: 2, languages: 'en' }
            });
        });
        it('is quiet for a removed field and honours the required languages', () => {
            const plain = F('a', 'InputText', { label: 'ስም', removed: true });
            expect(ofRule(lintDocument(doc([plain])), 'untranslated')).toEqual([]);
            const one = lintDocument(doc([F('a', 'InputText', { label: 'ስም' })]), { required: ['am'] });
            expect(ofRule(one, 'untranslated')).toEqual([]);
        });
    });

    describe('required-hideable', () => {
        const required = { props: { required: true } };
        it('warns for a required field that can be hidden and starts empty', () => {
            const byRule = lintDocument(
                doc([F('x'), F('a', 'InputText', { ...required, ...show({ field: 'x', operator: 'notEmpty' }) })])
            );
            const byRole = lintDocument(doc([F('a', 'InputText', { ...required, visibleToRoles: ['clerk'] })]));
            const byParent = lintDocument(
                doc([
                    F('x'),
                    panel('p', show({ field: 'x', operator: 'notEmpty' })),
                    F('a', 'InputText', { ...required, parentId: 'p' })
                ])
            );
            for (const problems of [byRule, byRole, byParent])
                expect(ofRule(problems, 'required-hideable')).toHaveLength(1);
        });
        it('is quiet when it cannot be hidden, has a default, or is not required', () => {
            const plain = lintDocument(doc([F('a', 'InputText', required)]));
            const filled = lintDocument(
                doc([F('a', 'InputText', { props: { required: true, value: 'x' }, visibleToRoles: ['clerk'] })])
            );
            const optional = lintDocument(doc([F('a', 'InputText', { visibleToRoles: ['clerk'] })]));
            for (const problems of [plain, filled, optional]) expect(ofRule(problems, 'required-hideable')).toEqual([]);
        });
    });

    describe('unknown-option', () => {
        it('warns for an eq or in value that is not an option', () => {
            const problems = lintDocument(
                doc([
                    choice,
                    F('a', 'InputText', show({ field: 'office', operator: 'eq', value: 'city' })),
                    F('b', 'InputText', show({ field: 'office', operator: 'in', value: ['town', 'city'] }))
                ])
            );
            expect(ofRule(problems, 'unknown-option').map((p) => [p.fieldId, p.values?.value])).toEqual([
                ['a', 'city'],
                ['b', 'city']
            ]);
        });
        it('is quiet for an option, a binding, or a field whose options come from an API', () => {
            const bound = F('api', 'Dropdown', {
                data: { optionsBinding: { dataSourceId: 'ds' } },
                props: { options: [{ value: 'x' }] }
            });
            const problems = lintDocument(
                doc([
                    choice,
                    bound,
                    F('a', 'InputText', show({ field: 'office', operator: 'eq', value: 'woreda' })),
                    F('b', 'InputText', show({ field: 'office', operator: 'eq', value: '{{form.z}}' })),
                    F('c', 'InputText', show({ field: 'api', operator: 'eq', value: 'other' }))
                ])
            );
            expect(ofRule(problems, 'unknown-option')).toEqual([]);
        });
    });

    describe('reads-removed', () => {
        it('warns when a computed field or validWhen reads a removed key', () => {
            const problems = lintDocument(
                doc([
                    F('old', 'InputNumber', { removed: true }),
                    F('a', 'InputNumber', { data: { computed: { expression: '{{= form.old * 2}}' } } }),
                    F('b', 'InputNumber', {
                        behavior: { validation: { supported: true, validWhen: [{ expression: 'form.old > 0' }] } }
                    })
                ])
            );
            expect(ofRule(problems, 'reads-removed').map((p) => [p.fieldId, p.severity, p.values?.key])).toEqual([
                ['a', 'warning', 'old'],
                ['b', 'warning', 'old']
            ]);
        });
        it('is quiet for a live key, and for a removed field that reads', () => {
            const problems = lintDocument(
                doc([
                    F('old', 'InputNumber', { removed: true }),
                    F('live', 'InputNumber'),
                    F('a', 'InputNumber', { data: { computed: { expression: '{{= form.live * 2}}' } } }),
                    F('b', 'InputNumber', { removed: true, data: { computed: { expression: '{{= form.old}}' } } })
                ])
            );
            expect(ofRule(problems, 'reads-removed')).toEqual([]);
        });
    });

    describe('unknown-role', () => {
        it('warns for a role that does not exist, only when the roles are given', () => {
            const form = doc([F('a', 'InputText', { visibleToRoles: ['clerk', 'wizard'] })]);
            const found = ofRule(lintDocument(form, { roleKeys: ['clerk'] }), 'unknown-role');
            expect(found.map((p) => p.values?.role)).toEqual(['wizard']);
            expect(ofRule(lintDocument(form), 'unknown-role')).toEqual([]);
            expect(ofRule(lintDocument(form, { roleKeys: ['clerk', 'wizard'] }), 'unknown-role')).toEqual([]);
        });
    });

    it('never makes a removed field, or a field inside a removed container, a subject', () => {
        const bad = show({ field: 'nope', operator: 'eq', value: 'a' }, { field: 'nope', operator: 'eq', value: 'b' });
        const problems = lintDocument(
            doc([
                F('gone', 'InputText', { removed: true, visibleToRoles: ['wizard'], ...bad }),
                panel('box', { removed: true }),
                F('inside', 'InputText', { parentId: 'box', visibleToRoles: ['wizard'], ...bad })
            ]),
            { roleKeys: [] }
        );
        expect(problems).toEqual([]);
    });
});
