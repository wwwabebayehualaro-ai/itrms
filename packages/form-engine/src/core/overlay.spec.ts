/**
 * Form overlays (task 0.21f): composed onto a base in order, root side first; each operation that no longer fits is
 * passed over and reported while the rest applies; nothing touches a bureau field but a choice's options, never a locked
 * one; an overlay is checked strictly when it is written.
 */
import { describe, expect, it } from 'vitest';

import type { FormOverlay } from '@itrms/schemas';

import { applyOverlays, checkOverlay, readDocument } from './';

const F = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    label: { am: id, en: id },
    props: {},
    classification: 'personal' as const,
    ...extra
});
const panel = (id: string, extra: Record<string, unknown> = {}) =>
    F(id, { type: 'Panel', category: 'Layout', layout: { options: { isContainer: true } }, ...extra });
const choice = (id: string) =>
    F(id, {
        type: 'Dropdown',
        data: {
            dataSource: {
                staticData: [
                    { label: { am: 'ሀ', en: 'A' }, value: 'a' },
                    { label: { am: 'ለ', en: 'B' }, value: 'b' },
                    { label: { am: 'ሐ', en: 'C' }, value: 'c' }
                ]
            }
        }
    });
const BASE = {
    schemaVersion: 2,
    fields: [
        F('plate'),
        panel('owner'),
        F('ownerName', { parentId: 'owner' }),
        choice('category'),
        F('lines', { type: 'FormArray', category: 'Layout', layout: { options: { isContainer: true } } }),
        F('qty', { parentId: 'lines' })
    ]
};
const overlay = (patch: Partial<FormOverlay>): FormOverlay => ({ add: [], options: [], ...patch });
const ids = (doc: unknown) => readDocument(doc).fields.map((f) => `${f.id}${f.parentId ? `<${f.parentId}` : ''}`);

describe('applyOverlays', () => {
    it('adds fields right after their anchor, in the anchor’s container, nested ones in theirs', () => {
        const { document, conflicts } = applyOverlays(BASE, [
            {
                unitId: 'zone',
                versionId: 'z1',
                patch: overlay({
                    add: [
                        { after: 'plate', fields: [F('x_local_q')] },
                        { after: 'ownerName', fields: [panel('x_box'), F('x_inner', { parentId: 'x_box' })] }
                    ]
                })
            }
        ]);
        expect(conflicts).toEqual([]);
        expect(ids(document)).toEqual([
            'plate',
            'x_local_q',
            'owner',
            'ownerName<owner',
            'x_box<owner',
            'x_inner<x_box',
            'category',
            'lines',
            'qty<lines'
        ]);
        expect(readDocument(document).fields.find((f) => f.id === 'x_local_q')?.source).toMatchObject({
            metadata: { overlay: { unitId: 'zone' } }
        });
        // the base is not changed
        expect(ids(BASE)).toEqual(['plate', 'owner', 'ownerName<owner', 'category', 'lines', 'qty<lines']);
    });

    it('stacks a zone’s overlay then a woreda’s, which may anchor on the zone’s field', () => {
        const { document } = applyOverlays(BASE, [
            { unitId: 'zone', versionId: 'z1', patch: overlay({ add: [{ after: 'plate', fields: [F('x_zone_q')] }] }) },
            {
                unitId: 'woreda',
                versionId: 'w1',
                patch: overlay({ add: [{ after: 'x_zone_q', fields: [F('x_woreda_q')] }] })
            }
        ]);
        expect(ids(document).slice(0, 3)).toEqual(['plate', 'x_zone_q', 'x_woreda_q']);
    });

    it('passes over what no longer fits and applies the rest', () => {
        const { document, conflicts } = applyOverlays(BASE, [
            {
                unitId: 'woreda',
                versionId: 'w1',
                patch: overlay({
                    add: [
                        { after: 'gone', fields: [F('x_a')] },
                        { after: 'qty', fields: [F('x_b')] },
                        { after: 'plate', fields: [F('x_c')] }
                    ],
                    options: [
                        { key: 'category', values: ['a', 'zz'] },
                        { key: 'nowhere', values: ['a'] }
                    ]
                })
            }
        ]);
        expect(conflicts).toEqual([
            { unitId: 'woreda', versionId: 'w1', op: 'add', key: 'gone', problem: 'anchor_missing' },
            { unitId: 'woreda', versionId: 'w1', op: 'add', key: 'qty', problem: 'anchor_in_rows' },
            { unitId: 'woreda', versionId: 'w1', op: 'options', key: 'category', problem: 'option_not_allowed' },
            { unitId: 'woreda', versionId: 'w1', op: 'options', key: 'nowhere', problem: 'field_missing' }
        ]);
        expect(ids(document)).toContain('x_c');
        expect(ids(document)).not.toContain('x_a');
    });

    it('narrows a choice to part of the bureau’s options, keeping its labels and order; never a locked one', () => {
        const narrowed = applyOverlays(BASE, [
            { unitId: 'zone', versionId: 'z1', patch: overlay({ options: [{ key: 'category', values: ['c', 'a'] }] }) }
        ]);
        expect(
            readDocument(narrowed.document, { language: 'en' }).fields.find((f) => f.id === 'category')?.options
        ).toEqual([
            expect.objectContaining({ label: 'A', value: 'a' }),
            expect.objectContaining({ label: 'C', value: 'c' })
        ]);
        const locked = applyOverlays(
            BASE,
            [{ unitId: 'zone', versionId: 'z1', patch: overlay({ options: [{ key: 'category', values: ['a'] }] }) }],
            { locks: new Set(['category']) }
        );
        expect(locked.conflicts).toEqual([
            { unitId: 'zone', versionId: 'z1', op: 'options', key: 'category', problem: 'locked' }
        ]);
        expect(readDocument(locked.document).fields.find((f) => f.id === 'category')?.options).toHaveLength(3);
    });

    it('passes over an addition whose key the bureau now has, and a whole overlay that makes the form unsound', () => {
        const base = { ...BASE, fields: [...BASE.fields, F('x_local_q')] };
        expect(
            applyOverlays(base, [
                {
                    unitId: 'zone',
                    versionId: 'z1',
                    patch: overlay({ add: [{ after: 'plate', fields: [F('x_local_q')] }] })
                }
            ]).conflicts
        ).toEqual([{ unitId: 'zone', versionId: 'z1', op: 'add', key: 'plate', problem: 'key_taken' }]);

        // an added field reading a field the form does not have is a lint error the base did not have
        const unsound = applyOverlays(BASE, [
            {
                unitId: 'zone',
                versionId: 'z1',
                patch: overlay({
                    add: [
                        {
                            after: 'plate',
                            fields: [
                                F('x_q', {
                                    behavior: { visibilityConditions: [{ field: 'nothing', operator: 'eq', value: 1 }] }
                                })
                            ]
                        }
                    ]
                })
            }
        ]);
        expect(unsound.conflicts).toEqual([
            { unitId: 'zone', versionId: 'z1', op: 'overlay', key: null, problem: 'invalid' }
        ]);
        expect(ids(unsound.document)).not.toContain('x_q');
    });
});

describe('what an overlay may never do', () => {
    it('adds no field with actions (they could set a bureau answer or leave the form)', () => {
        for (const actions of [
            { onChange: [{ type: 'setValue', payload: { field: 'plate', value: 'x' } }] },
            { onChange: [{ type: 'navigate', payload: { url: 'https://example.org' } }] },
            [{ type: 'apiCall' }]
        ])
            expect(
                checkOverlay(
                    BASE,
                    overlay({ add: [{ after: 'plate', fields: [F('x_act', { behavior: { actions } })] }] })
                )
            ).toEqual([{ op: 'add', key: 'x_act', problem: 'not_allowed_property' }]);
    });

    it('narrows no option a bureau rule reads (it could keep a bureau field hidden or never required)', () => {
        const base = {
            schemaVersion: 2,
            fields: [
                choice('category'),
                F('detail', { behavior: { visibilityConditions: [{ field: 'category', operator: 'eq', value: 'a' }] } })
            ]
        };
        expect(checkOverlay(base, overlay({ options: [{ key: 'category', values: ['b'] }] }))).toEqual([
            { op: 'options', key: 'category', problem: 'locked' }
        ]);
        const composed = applyOverlays(base, [
            { unitId: 'zone', versionId: 'z1', patch: overlay({ options: [{ key: 'category', values: ['b'] }] }) }
        ]);
        expect(composed.conflicts).toEqual([
            { unitId: 'zone', versionId: 'z1', op: 'options', key: 'category', problem: 'locked' }
        ]);
        // nothing of it changed the form: it is not counted as applied
        expect(composed.applied).toEqual([]);

        // a condition comparing with it through a binding reads it too
        const bound = {
            schemaVersion: 2,
            fields: [
                choice('category'),
                F('kind'),
                F('detail', {
                    behavior: {
                        visibilityConditions: [{ field: 'kind', operator: 'eq', value: '{{ form.category }}' }]
                    }
                })
            ]
        };
        expect(checkOverlay(bound, overlay({ options: [{ key: 'category', values: ['b'] }] }))).toEqual([
            { op: 'options', key: 'category', problem: 'locked' }
        ]);
    });
});

describe('checkOverlay', () => {
    it('refuses unreserved, taken and misplaced keys, forbidden properties and options it may not narrow', () => {
        const problems = checkOverlay(
            BASE,
            overlay({
                add: [
                    {
                        after: 'plate',
                        fields: [
                            F('local'),
                            F('plate'),
                            F('x_inner', { parentId: 'owner' }),
                            F('x_bound', { filterable: true })
                        ]
                    },
                    { after: 'qty', fields: [F('x_row')] }
                ],
                options: [
                    { key: 'category', values: ['a'] },
                    { key: 'plate', values: ['a'] }
                ]
            }),
            { locks: new Set(['category']), takenKeys: new Set(['x_row']) }
        );
        expect(problems).toEqual([
            { op: 'add', key: 'local', problem: 'key_reserved' },
            { op: 'add', key: 'plate', problem: 'key_reserved' },
            { op: 'add', key: 'x_inner', problem: 'nested_outside' },
            { op: 'add', key: 'x_bound', problem: 'not_allowed_property' },
            { op: 'add', key: 'qty', problem: 'anchor_in_rows' },
            { op: 'add', key: 'x_row', problem: 'key_taken' },
            { op: 'options', key: 'category', problem: 'locked' },
            { op: 'options', key: 'plate', problem: 'not_choice' }
        ]);
        expect(checkOverlay(BASE, overlay({ add: [{ after: 'plate', fields: [F('x_ok')] }] }))).toEqual([]);
    });
});
