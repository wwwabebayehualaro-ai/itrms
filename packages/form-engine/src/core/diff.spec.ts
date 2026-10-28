// @vitest-environment node
// What changed between two versions of a form (task 0.18a).
import { describe, expect, it } from 'vitest';

import { diffDocuments, type DiffChange } from './';

const F = (id: string, type = 'InputText', extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: { am: id, en: id },
    props: {},
    ...extra
});
const doc = (fields: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ fields, ...extra });
const areas = (changes: DiffChange[] | undefined) => (changes ?? []).map((c) => c.area);
const changesOf = (a: unknown, b: unknown, key: string) =>
    diffDocuments(a, b).changed.find((c) => c.key === key)?.changes;

describe('diffDocuments', () => {
    it("shows a field's data class changing, set or taken away (task 0.20d: the approver sees it)", () => {
        const sensitive = changesOf(
            doc([F('fin')]),
            doc([F('fin', 'InputText', { classification: 'sensitive' })]),
            'fin'
        );
        expect(sensitive).toContainEqual({ area: 'classification', before: null, after: 'sensitive' });
        const personal = changesOf(
            doc([F('fin', 'InputText', { classification: 'sensitive' })]),
            doc([F('fin', 'InputText', { classification: 'personal' })]),
            'fin'
        );
        expect(personal).toContainEqual({ area: 'classification', before: 'sensitive', after: 'personal' });
    });

    it('finds nothing between equal documents', () => {
        const d = doc([F('a'), F('b', 'Dropdown', { props: { options: [{ value: 'x', label: 'X' }] } })]);
        expect(diffDocuments(d, structuredClone(d))).toEqual({
            added: [],
            removed: [],
            restored: [],
            changed: [],
            form: []
        });
    });

    it('lists added, deleted, newly removed and restored fields', () => {
        const a = doc([F('keep'), F('gone'), F('flag'), F('back', 'InputText', { removed: true })]);
        const b = doc([F('keep'), F('flag', 'InputText', { removed: true }), F('back'), F('fresh', 'InputNumber')]);
        const diff = diffDocuments(a, b);
        expect(diff.added).toEqual([{ key: 'fresh', label: 'fresh', type: 'InputNumber' }]);
        expect(diff.removed.map((f) => f.key)).toEqual(['gone', 'flag']);
        expect(diff.restored.map((f) => f.key)).toEqual(['back']);
        expect(diff.changed).toEqual([]);
    });

    it('lists what is inside a container newly removed, and inside one taken back', () => {
        const panel = (extra: Record<string, unknown> = {}) => F('addr', 'Panel', extra);
        const inside = [F('kebele', 'InputText', { parentId: 'addr' }), F('woreda', 'InputText', { parentId: 'addr' })];
        const live = doc([F('name'), panel(), ...inside]);
        const out = doc([F('name'), panel({ removed: true }), ...inside]);
        const removed = diffDocuments(live, out);
        expect(removed.removed.map((f) => f.key)).toEqual(['addr', 'kebele', 'woreda']);
        expect(removed.changed).toEqual([]);
        expect(diffDocuments(out, live).restored.map((f) => f.key)).toEqual(['addr', 'kebele', 'woreda']);
        // deleted together with its already removed container: nothing new
        expect(diffDocuments(out, doc([F('name')])).removed).toEqual([]);
    });

    it('does not list a field that was already removed and is deleted', () => {
        expect(diffDocuments(doc([F('old', 'InputText', { removed: true })]), doc([])).removed).toEqual([]);
    });

    it('reports a label change per language', () => {
        const b = doc([F('a', 'InputText', { label: { am: 'a', en: 'Applicant' } })]);
        expect(changesOf(doc([F('a')]), b, 'a')).toEqual([{ area: 'label', languages: ['en'] }]);
    });

    it('reads a plain string in the form text language', () => {
        const a = doc([F('a', 'InputText', { label: 'ስም' })]);
        const b = doc([F('a', 'InputText', { label: 'የአመልካች ስም' })]);
        expect(changesOf(a, b, 'a')).toEqual([{ area: 'label', languages: ['am'] }]);
    });

    it('reports other texts, type, kind, parent, order and roles', () => {
        const a = doc([F('p', 'Panel', { category: 'Layout' }), F('a', 'InputText'), F('b', 'InputText')]);
        const b = doc([
            F('p', 'Panel', { category: 'Layout' }),
            F('b', 'InputText'),
            F('a', 'InputNumber', { parentId: 'p', props: { helpText: { am: 'እገዛ' } }, visibleToRoles: ['clerk'] })
        ]);
        expect(areas(changesOf(a, b, 'a'))).toEqual(['type', 'kind', 'parent', 'order', 'texts', 'roles']);
        expect(changesOf(a, b, 'b')).toEqual([{ area: 'order', before: 2, after: 1 }]);
    });

    it('does not count a new sibling as an order change', () => {
        expect(diffDocuments(doc([F('a'), F('b')]), doc([F('new'), F('a'), F('b')])).changed).toEqual([]);
    });

    it('reports options added, removed and relabelled', () => {
        const opt = (value: string, en = value) => ({ value, label: { am: value, en } });
        const a = doc([F('o', 'Dropdown', { props: { options: [opt('x'), opt('y')] } })]);
        const b = doc([F('o', 'Dropdown', { props: { options: [opt('x', 'Ex'), opt('z')] } })]);
        const changes = changesOf(a, b, 'o') ?? [];
        expect(changes).toContainEqual({ area: 'options', before: ['y'], after: ['z'] });
        expect(changes).toContainEqual({ area: 'options', languages: ['en'], key: 'props.options.0.label' });
    });

    it('reports required, rules, visibility, enabled, computed, filterable and settings', () => {
        const a = doc([F('a', 'InputNumber', { props: { min: 1 } })]);
        const b = doc([
            F('a', 'InputNumber', {
                props: { min: 2, required: true },
                filterable: true,
                data: { computed: { expression: '{{= 1}}' } },
                behavior: {
                    validation: { supported: true, rules: { max: 9 } },
                    visibilityConditions: [{ field: 'x', operator: 'notEmpty' }],
                    enabledConditions: [{ field: 'x', operator: 'empty' }]
                }
            })
        ]);
        const changes = changesOf(a, b, 'a') ?? [];
        expect(areas(changes)).toEqual([
            'required',
            'rules',
            'visibility',
            'enabled',
            'computed',
            'filterable',
            'settings'
        ]);
        expect(changes.at(-1)).toEqual({ area: 'settings', key: 'min', before: 1, after: 2 });
    });

    it('ignores a change in a removed field and the key order of objects', () => {
        const a = doc([
            F('a', 'InputText', { removed: true, props: { maxLength: 3 } }),
            F('b', 'InputText', { props: { x: 1, y: 2 } })
        ]);
        const b = doc([
            F('a', 'InputText', { removed: true, props: { maxLength: 9 } }),
            F('b', 'InputText', { props: { y: 2, x: 1 } })
        ]);
        expect(diffDocuments(a, b).changed).toEqual([]);
    });

    it('reports form-level changes', () => {
        const source = { id: 'ds', request: { method: 'GET', url: 'v1/registry-lookups/x' } };
        const b = doc([F('a')], {
            textLanguage: 'en',
            runtime: { dataSources: [source], variables: [] },
            testCases: [{ id: 't', name: 'T', values: {}, expect: { valid: true } }]
        });
        expect(diffDocuments(doc([F('a')]), b).form.map((f) => f.area)).toEqual([
            'dataSources',
            'testCases',
            'textLanguage'
        ]);
    });
});
