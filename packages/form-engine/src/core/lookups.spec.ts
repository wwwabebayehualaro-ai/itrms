// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { lookupRefs, readDocument } from './';

const A = '0b8f7a52-3c1d-4e6a-9f10-5d2c8e7b1a34';
const B = '5a1c9e22-7d3b-4c80-8a46-1f9e0b2d6c57';
const C = '9d4e2b61-0a7f-4b35-b8c2-6e1a3f5d8097';

const F = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    category: 'Input',
    props: {},
    ...extra
});
const lookup = (id: string, provider: string, extra: Record<string, unknown> = {}) =>
    F(id, 'RegistryLookup', { props: { provider }, ...extra });

const fields = (list: unknown[]) => readDocument({ fields: list }).fields;

describe('lookupRefs', () => {
    it('lists every lookup answer with its provider', () => {
        const f = fields([lookup('owner', 'person'), lookup('company', 'organisation'), F('note', 'InputText')]);
        expect(lookupRefs(f, { owner: A, company: B, note: C })).toEqual([
            { path: 'owner', provider: 'person', id: A },
            { path: 'company', provider: 'organisation', id: B }
        ]);
    });

    it('names the row of a repeatable section in the path', () => {
        const f = fields([
            F('members', 'FormArray', { category: 'Layout', layout: { options: { isContainer: true } } }),
            lookup('person', 'person', { parentId: 'members' }),
            F('role', 'InputText', { parentId: 'members' })
        ]);
        expect(lookupRefs(f, { members: [{ person: A, role: 'x' }, { role: 'y' }, { person: B }] })).toEqual([
            { path: 'members[0].person', provider: 'person', id: A },
            { path: 'members[2].person', provider: 'person', id: B }
        ]);
    });

    it('leaves out the answers of hidden fields, blanks and values that are not text', () => {
        const f = fields([
            F('kind', 'InputText'),
            lookup('owner', 'person', {
                behavior: { visibilityConditions: [{ field: 'kind', operator: 'eq', value: 'person' }] }
            }),
            lookup('spare', 'person'),
            lookup('other', 'person'),
            lookup('no-provider', '')
        ]);
        expect(lookupRefs(f, { kind: 'company', owner: A, spare: '', other: 12, 'no-provider': C })).toEqual([]);
        expect(lookupRefs(f, { kind: 'person', owner: A })).toEqual([{ path: 'owner', provider: 'person', id: A }]);
    });
});
