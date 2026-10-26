// @vitest-environment node
// Ported from the legacy backend's test_form_config.py: the API refuses a form the engine cannot read.
import { describe, expect, it } from 'vitest';

import { checkDocument, FIELD_TYPES } from './';

const F = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, props: {}, ...extra });
const problems = (doc: unknown) => Object.fromEntries(checkDocument(doc).map((p) => [p.path, p.message]));

describe('checkDocument', () => {
    it('knows the field kit', () => {
        expect(FIELD_TYPES).toContain('InputText');
        expect(FIELD_TYPES).toContain('FormArray');
    });

    it('passes valid forms, also in older shapes', () => {
        expect(
            checkDocument({
                schemaVersion: 2,
                fields: [
                    F('box', 'Panel', { layout: { options: { isContainer: true } } }),
                    F('name', 'InputText', { parentId: 'box', anything: { old: 'keys' } })
                ],
                runtime: { dataSources: [] }
            })
        ).toEqual([]);
        expect(checkDocument([F('name', 'InputText')])).toEqual([]); // the oldest format: a bare list
        expect(checkDocument({ fields: [] })).toEqual([]);
    });

    it('names unknown types and bad shapes', () => {
        const p = problems({
            fields: [F('a', 'TabView'), { type: 'InputText' }],
            runtime: { dataSources: [{ id: '1bad', request: { method: 'GET', url: '/x' } }] }
        });
        expect(p['fields[0].type']).toBe('"TabView" is not a field type this version knows');
        expect(Object.keys(p)).toContain('fields[1].id');
        expect(Object.keys(p)).toContain('runtime.dataSources[0].id');
        expect(checkDocument({ fields: 'nope' })).not.toEqual([]);
        expect(checkDocument('nope')).not.toEqual([]);
    });

    it('checks the structure: unique keys, parents that exist, no loops', () => {
        const p = problems({
            fields: [
                F('a', 'InputText'),
                F('a', 'InputText'),
                F('x', 'InputText', { parentId: 'gone' }),
                F('p', 'Panel', { parentId: 'q' }),
                F('q', 'Panel', { parentId: 'p' })
            ]
        });
        expect(p['fields[1].id']).toBe('The key "a" is used by field 1 too');
        expect(p['fields[2].parentId']).toBe('"x" sits in "gone", which is not a field of this form');
        expect(p['fields[3].parentId']).toMatch(/loop/);
    });

    it('refuses keys an object inherits', () => {
        for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'created_at', 'handlingUnit'])
            expect(problems({ fields: [F(key, 'InputText')] })['fields[0].id']).toBe(`"${key}" cannot be a field key`);
    });

    it('needs a provider on a registry lookup', () => {
        expect(FIELD_TYPES).toContain('RegistryLookup');
        expect(checkDocument({ fields: [F('owner', 'RegistryLookup', { props: { provider: 'person' } })] })).toEqual(
            []
        );
        for (const props of [{}, { provider: '' }, { provider: 3 }])
            expect(problems({ fields: [F('owner', 'RegistryLookup', { props })] })['fields[0].props.provider']).toBe(
                'A registry lookup needs a provider'
            );
    });
});
