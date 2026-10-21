// The form engine's extension points, end to end without a browser:  pnpm --filter @itrms/form-engine check:engine
//
// A feature team adds a field type with `defineFieldType` (how it renders) + `describeFieldType` (how the builder offers it), and a
// custom action with `registerAction`. This checks that such a type is drawable, offered in the palette, created by the builder
// with its starting settings, edited through its settings schema, and that a custom action runs (and a stored template cannot
// smuggle code in).
import assert from 'node:assert/strict';
import { z } from 'zod';

await import('../src/renderer/fields/registerAll');
const { defineFieldType, describeFieldType, unsupportedFields, designableTypes } = await import('../src/renderer/kit');
const { registerAction } = await import('../src/renderer/extensions');
const { runAction } = await import('../src/renderer/actions');
const { readDocument } = await import('../src/core');
const { EMPTY_DOC, createField } = await import('../src/designer/document');
const { settingsOf } = await import('../src/designer/SettingsForm');

// ---- a custom field type ---------------------------------------------------------------------------------------------
const doc = (type: string) => readDocument({ fields: [{ id: 'x', type, label: 'X', category: 'Input', props: {} }] });
assert.equal(unsupportedFields(doc('Iban').fields).length, 1, 'an unknown type is reported, not rendered');

defineFieldType({ kind: 'value', type: 'Iban', Render: () => null });
describeFieldType('Iban', {
    label: 'IBAN',
    icon: () => null,
    group: 'Text & numbers',
    rules: ['pattern'],
    defaults: { country: 'DE' },
    settings: z.object({
        country: z
            .enum(['DE', 'FR'])
            .optional()
            .meta({ title: 'Country', labels: { DE: 'Germany', FR: 'France' } }),
        grouped: z.boolean().optional().meta({ title: 'Grouped in fours' })
    })
});
assert.equal(unsupportedFields(doc('Iban').fields).length, 0, 'a defined type renders');
assert.ok(
    designableTypes().some((d) => d.type === 'Iban'),
    'a described type is offered in the palette'
);

const created = createField(EMPTY_DOC, 'Iban', 'Account IBAN')!;
assert.equal(created.id, 'accountIban', 'the key comes from the label');
assert.deepEqual(created.props, { country: 'DE' }, 'starting settings');
assert.equal(created.category, 'Input');
assert.equal(created.behavior?.validation?.supported, true, 'a value type is validated');
assert.equal(readDocument({ fields: [created] }).invalid.length, 0, 'what the builder creates is a valid stored field');

const specs = settingsOf(designableTypes().find((d) => d.type === 'Iban')!.design.settings);
assert.deepEqual(
    specs.map((s) => [s.key, s.kind, s.meta.title]),
    [
        ['country', 'enum', 'Country'],
        ['grouped', 'boolean', 'Grouped in fours']
    ],
    'the inspector is generated from the settings schema'
);
assert.deepEqual(specs[0]?.options, ['DE', 'FR']);

// every built-in type creates a field the engine reads and draws
for (const d of designableTypes()) {
    const f = createField(EMPTY_DOC, d.type, d.design.label)!;
    const read = readDocument({ fields: [f] });
    assert.equal(read.invalid.length, 0, `${d.type}: valid stored field`);
    assert.equal(unsupportedFields(read.fields).length, 0, `${d.type}: drawable`);
}

// ---- a custom action -------------------------------------------------------------------------------------------------
let seen: unknown = null;
registerAction('stamp', ({ payload, formValues, setFieldValue }) => {
    seen = { payload, total: formValues.total };
    setFieldValue?.('stamped', true);
    return 'done';
});
const set: Record<string, unknown> = {};
const result = await runAction(
    { type: 'custom', target: 'stamp', payload: { by: 'check' } },
    { formValues: { total: 3 }, setFieldValue: (k, v) => (set[k] = v) }
);
assert.equal(result, 'done');
assert.deepEqual(seen, { payload: { by: 'check' }, total: 3 });
// a copy: assert.deepEqual on `set` itself would narrow its type for the checks below
assert.deepEqual({ ...set }, { stamped: true });
// a stored template can only name a handler: a function smuggled into the payload never runs
let ran = false;
await runAction({ type: 'custom', target: 'nope', payload: { handler: () => (ran = true) } }, { formValues: {} });
assert.equal(ran, false, 'code in a template is never executed');
// conditions gate an action
await runAction(
    {
        type: 'setValue',
        payload: { field: 'a', value: '{{form.total}}' },
        conditions: [{ field: 'total', operator: 'gt', value: 5 }]
    },
    { formValues: { total: 3 }, setFieldValue: (k, v) => (set[k] = v) }
);
assert.equal(set.a, undefined);
await runAction(
    { type: 'setValue', payload: { field: 'a', value: '{{form.total}}' } },
    { formValues: { total: 3 }, setFieldValue: (k, v) => (set[k] = v) }
);
assert.equal(set.a, 3);

console.log(`form-engine extension points ok (${designableTypes().length} designable types)`);
