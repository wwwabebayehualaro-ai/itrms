// @vitest-environment node
// Key stability (task 0.18a): a published key stays, keeps its kind and its row scope.
import { describe, expect, it } from 'vitest';

import { checkKeyStability, keepPublishedKeys, publishedKeysOf, readDocument } from './';

const F = (id: string, type = 'InputText', extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    ...extra
});
const section = (id: string, extra: Record<string, unknown> = {}) => F(id, 'FormArray', extra);
const panel = (id: string) => F(id, 'Panel', { category: 'Layout', layout: { options: { isContainer: true } } });
const doc = (...fields: Record<string, unknown>[]) => ({ fields });
const rowQty = () => F('qty', 'InputNumber', { parentId: 'rows' });

describe('publishedKeysOf', () => {
    it('lists value fields with kind and row scope, panels not counted', () => {
        const keys = publishedKeysOf(
            doc(
                F('name'),
                panel('p'),
                F('inPanel', 'InputNumber', { parentId: 'p' }),
                section('rows'),
                rowQty(),
                F('who', 'RegistryLookup', { props: { provider: 'persons' } })
            )
        );
        expect([...keys.keys()]).toEqual(['name', 'inPanel', 'rows', 'qty', 'who']);
        expect(keys.get('name')).toMatchObject({ kind: 'text', scope: null, type: 'InputText', label: 'name' });
        expect(keys.get('inPanel')).toMatchObject({ kind: 'number', scope: null });
        expect(keys.get('qty')).toMatchObject({ kind: 'number', scope: 'rows' });
        expect(keys.get('rows')).toMatchObject({ kind: 'rows', scope: null });
        expect(keys.get('who')?.kind).toBe('ref:persons');
    });

    it('keeps removed fields: a flagged key is still a published key', () => {
        expect(publishedKeysOf(doc(F('old', 'InputText', { removed: true }))).has('old')).toBe(true);
    });
});

describe('checkKeyStability', () => {
    const base = doc(F('name'), F('office', 'Dropdown'), section('rows'), rowQty());

    it('is quiet for the same form, new keys, a text becoming a text area, and removing and restoring', () => {
        const next = doc(
            F('name', 'InputTextarea', { label: 'Full name' }),
            F('office', 'RadioButton'),
            section('rows'),
            rowQty(),
            F('extra')
        );
        expect(checkKeyStability(base, next)).toEqual([]);
        const removed = doc(
            F('name', 'InputText', { removed: true }),
            F('office', 'Dropdown'),
            section('rows'),
            rowQty()
        );
        expect(checkKeyStability(base, removed)).toEqual([]);
        expect(checkKeyStability(removed, base)).toEqual([]);
    });

    it('reports a missing key', () => {
        const problems = checkKeyStability(base, doc(F('name'), section('rows'), rowQty()));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ rule: 'key-missing', severity: 'error', fieldId: 'office' });
    });

    it('reports a changed kind: a single choice may not become a multiple one', () => {
        const next = doc(F('name'), F('office', 'Dropdown', { props: { multiple: true } }), section('rows'), rowQty());
        expect(checkKeyStability(base, next).map((p) => [p.rule, p.fieldId, p.path])).toEqual([
            ['key-retyped', 'office', 'fields[1].type']
        ]);
        expect(checkKeyStability(doc(F('n')), doc(F('n', 'InputNumber')))[0]?.rule).toBe('key-retyped');
    });

    it('reports a key that moved into or out of a repeatable section', () => {
        const out = doc(F('name'), F('office', 'Dropdown'), section('rows'), F('qty', 'InputNumber'));
        expect(checkKeyStability(base, out).map((p) => [p.rule, p.fieldId])).toEqual([['key-moved', 'qty']]);
        const into = doc(
            F('name', 'InputText', { parentId: 'rows' }),
            F('office', 'Dropdown'),
            section('rows'),
            rowQty()
        );
        expect(checkKeyStability(base, into).map((p) => p.rule)).toEqual(['key-moved']);
    });
});

describe('keepPublishedKeys', () => {
    const published = doc(F('name'), panel('p'), F('office', 'Dropdown', { parentId: 'p' }), section('rows'), rowQty());

    it('adds every missing published key flagged removed, in its container when that exists', () => {
        const older = doc(F('name'), panel('p'));
        const kept = readDocument(keepPublishedKeys(older, published)).fields;
        expect(kept.map((f) => [f.id, f.removed, f.parentId])).toEqual([
            ['name', false, null],
            ['p', false, null],
            ['office', true, 'p'],
            ['rows', true, null],
            ['qty', true, 'rows']
        ]);
        expect(checkKeyStability(published, keepPublishedKeys(older, published))).toEqual([]);
    });

    it('puts a key at the top when its container is gone, and leaves present keys alone', () => {
        const older = doc(F('name', 'InputText', { label: 'kept' }));
        const kept = readDocument(keepPublishedKeys(older, published)).fields;
        expect(kept.find((f) => f.id === 'office')).toMatchObject({ removed: true, parentId: null });
        expect(kept.find((f) => f.id === 'name')).toMatchObject({ label: 'kept', removed: false });
    });

    it('does not change its inputs, and keeps a bare list a list', () => {
        const older = doc(F('name'));
        const snapshot = JSON.stringify(older);
        keepPublishedKeys(older, published);
        expect(JSON.stringify(older)).toBe(snapshot);
        expect(Array.isArray(keepPublishedKeys([F('name')], published))).toBe(true);
    });
});
