// @vitest-environment node
/**
 * core runs in the API (server-side validation of submissions), so it must load and work in plain Node: no window, no
 * document, no React. dependency-cruiser and the lint rule keep the imports out; this proves the result runs.
 */
import { describe, expect, it } from 'vitest';

describe('core in Node without a DOM', () => {
    it('has no browser globals in this environment', () => {
        expect('window' in globalThis).toBe(false);
        expect('document' in globalThis).toBe(false);
    });

    it('imports, reads a stored form and validates values', async () => {
        const core = await import('./index');
        // fields the way the builder writes them: validation switched on
        const checked = { validation: { supported: true } };
        const doc = core.readDocument({
            schemaVersion: 2,
            fields: [
                { id: 'name', type: 'InputText', label: 'Name', props: { required: true }, behavior: checked },
                {
                    id: 'days',
                    type: 'InputNumber',
                    label: 'Days',
                    props: {},
                    behavior: { validation: { supported: true, rules: { min: 1 } } }
                },
                {
                    id: 'reason',
                    type: 'InputTextarea',
                    label: 'Reason',
                    props: {},
                    behavior: { ...checked, visibilityConditions: [{ field: 'days', operator: 'gt', value: 3 }] }
                }
            ]
        });
        expect(doc.fields.map((f) => f.id)).toEqual(['name', 'days', 'reason']);
        expect(Object.keys(core.validateForm(doc.fields, { days: 0 }))).toEqual(['name', 'days']);
        expect(core.validateForm(doc.fields, { name: 'Abebe', days: 2 })).toEqual({});
        expect(core.pruneHidden(doc.fields, { name: 'Abebe', days: 2, reason: 'x' })).toEqual({
            name: 'Abebe',
            days: 2
        });
    });

    it('evaluates bindings and formulas', async () => {
        const { resolveString } = await import('./runtime/expression');
        expect(resolveString('{{= row.qty * row.price }}', { row: { qty: 3, price: 2.5 } })).toBe(7.5);
        expect(resolveString('{{user.name | default:"-"}}', { user: {} })).toBe('-');
    });
});
