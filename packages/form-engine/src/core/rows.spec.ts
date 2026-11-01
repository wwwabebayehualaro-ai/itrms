/**
 * Stable row ids (ADR-0040, task 0.21g): a row keeps its id through every value helper, the server gives one to every row
 * filed without one (old answers stay readable, G3), and derived fields are computed again without settling anything else.
 */
import { describe, expect, it } from 'vitest';

import {
    derivedValues,
    emptyRow,
    knownValues,
    readDocument,
    rowIdOf,
    submittedValues,
    withoutRowIds,
    withoutSensitive,
    withRowIds
} from './';

const F = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    category: 'Input',
    label: id,
    props: {},
    classification: 'personal',
    ...extra
});
const { fields } = readDocument({
    fields: [
        F('lines', { type: 'FormArray', category: 'Layout', layout: { options: { isContainer: true } } }),
        F('what', { parentId: 'lines' }),
        F('qty', { type: 'InputNumber', parentId: 'lines' }),
        F('lineTotal', {
            type: 'InputNumber',
            parentId: 'lines',
            data: { defaultProps: {}, computed: { expression: '{{= row.qty * root.rate }}', readOnly: true } }
        }),
        F('member', { parentId: 'lines' }),
        // a member's discount: hidden, it holds no value
        F('discount', {
            type: 'InputNumber',
            parentId: 'lines',
            behavior: { visibilityConditions: [{ field: 'member', operator: 'eq', value: 'yes' }] },
            data: { defaultProps: {}, computed: { expression: '{{= row.qty * 3 }}', readOnly: true } }
        }),
        F('rate', { type: 'InputNumber' }),
        F('switchedOff', { behavior: { enabledConditions: [{ field: 'rate', operator: 'eq', value: 99 }] } })
    ]
});
const ID = '0199f0a0-0000-7000-8000-000000000001';
const OTHER = '0199f0a0-0000-7000-8000-000000000002';

describe('row ids', () => {
    it('are made for a new row and kept through the value helpers', () => {
        const row = emptyRow(fields.find((f) => f.id === 'lines') as (typeof fields)[number], fields);
        expect(rowIdOf(row)).toEqual(expect.any(String));
        const values = { rate: 2, lines: [{ _id: ID, what: 'pen', qty: 3 }] };
        expect(knownValues(fields, values)).toEqual(values);
        expect((submittedValues(fields, values).lines as { _id: string }[])[0]?._id).toBe(ID);
        expect((withoutSensitive(fields, values).lines as { _id: string }[])[0]?._id).toBe(ID);
        // a malformed id is no id; a top-level _id is no answer
        expect(knownValues(fields, { _id: ID, lines: [{ _id: '<x>', what: 'pen' }] })).toEqual({
            lines: [{ what: 'pen' }]
        });
    });

    it('are given to rows filed without one, malformed or repeated (answers filed before ids stay readable)', () => {
        const given = withRowIds(fields, {
            lines: [{ what: 'a' }, { _id: ID, what: 'b' }, { _id: ID, what: 'c' }, { _id: 'no', what: 'd' }]
        });
        const ids = (given.lines as Record<string, unknown>[]).map((r) => rowIdOf(r));
        expect(ids[1]).toBe(ID);
        expect(new Set(ids).size).toBe(4);
        expect(ids.every((id) => typeof id === 'string')).toBe(true);
        expect((given.lines as Record<string, unknown>[]).map((r) => r.what)).toEqual(['a', 'b', 'c', 'd']);
    });
});

describe('derivedValues', () => {
    it('computes derived fields again over the answers, settling nothing else', () => {
        const values = { rate: 5, switchedOff: 'kept as filed', lines: [{ _id: ID, qty: 2, lineTotal: 4 }] };
        expect(derivedValues(fields, values)).toEqual({
            rate: 5,
            // a disabled input is not put back to its default: it is the filer's answer
            switchedOff: 'kept as filed',
            lines: [{ _id: ID, qty: 2, lineTotal: 10 }]
        });
        // where filing settles it back (a disabled field holds its default)
        expect(submittedValues(fields, values).switchedOff).toBeUndefined();
    });

    it('gives a derived field its rules hide no value, as filing does', () => {
        const values = {
            rate: 1,
            lines: [
                { _id: ID, qty: 2, member: 'no', discount: 6 },
                { _id: OTHER, qty: 4, member: 'yes' }
            ]
        };
        expect(derivedValues(fields, values).lines).toEqual([
            { _id: ID, qty: 2, member: 'no', lineTotal: 2 },
            { _id: OTHER, qty: 4, member: 'yes', lineTotal: 4, discount: 12 }
        ]);
    });
});

describe('withoutRowIds', () => {
    it('takes the ids out at any depth, and nothing else', () => {
        expect(
            withoutRowIds({ _id: 'top-level-x', lines: [{ _id: ID, qty: 1, parts: [{ _id: OTHER, n: 2 }] }] })
        ).toEqual({
            lines: [{ qty: 1, parts: [{ n: 2 }] }]
        });
    });
});
