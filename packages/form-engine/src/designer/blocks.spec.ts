/**
 * Reusable blocks in the builder (task 1.13d): a block's published version copied into a form as a section that remembers the
 * block and version, its keys prefixed only when they would clash (and its own references renamed with them), and the copy
 * updated to a newer version on the author's request, a published key the new version leaves out kept as removed.
 */
import { describe, expect, it } from 'vitest';
import '../renderer/fields/registerAll';

import { blockRefOf, blockUses } from '../core';
import { ROOT, fromStored, toStored } from './document';
import { blockPrefix } from './blocks';
import { createDesignerStore } from './store';
import type { BlockSource } from './blocks';

const f = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    data: { defaultProps: {} },
    layout: { options: { isContainer: false } },
    ...extra
});

const applicant = (version: number, fields = [f('name', 'InputText'), f('role', 'InputText')]): BlockSource => ({
    key: 'block-applicant',
    version,
    name: { am: 'አመልካች', en: 'Applicant' },
    document: { fields }
});

const storeWith = (fields: ReturnType<typeof f>[]) => {
    const { doc } = fromStored({ fields, runtime: { dataSources: [] } });
    return createDesignerStore(doc, { name: 'Form', slug: 'form', form_config: {} }, 'en');
};

describe('a block copied into a form', () => {
    it('is a section that remembers the block and version, with the block keys as they are when free', () => {
        const store = storeWith([f('title', 'InputText')]);
        const id = store.getState().actions.insertBlock(applicant(1));
        expect(id).toBeTruthy();
        const { doc } = store.getState();
        const section = doc.byId[id ?? ''];
        expect(section?.type).toBe('FormSection');
        expect(blockRefOf(section)).toEqual({ key: 'block-applicant', version: 1, prefix: '' });
        expect(doc.children[ROOT]).toEqual(['title', id]);
        expect(doc.children[id ?? '']).toEqual(['name', 'role']);
        // the stored document says which block versions it holds
        expect(blockUses(toStored(doc), 'block-applicant')).toEqual([1]);
    });

    it("prefixes the copy's keys when one is taken, and renames the copy's own references with them", () => {
        const withRule = applicant(1, [
            f('name', 'InputText'),
            f('role', 'InputText', {
                behavior: { visibilityConditions: [{ field: 'name', operator: 'notEmpty', value: '' }] }
            })
        ]);
        expect(blockPrefix(withRule, new Set(['title']))).toBe('');
        expect(blockPrefix(withRule, new Set(['name']))).toBe('blockApplicant2_');
        const store = storeWith([f('name', 'InputText')]);
        const id = store.getState().actions.insertBlock(withRule) ?? '';
        const { doc } = store.getState();
        expect(doc.children[id]).toEqual(['blockApplicant2_name', 'blockApplicant2_role']);
        expect(doc.byId.blockApplicant2_role?.behavior?.visibilityConditions?.[0]?.field).toBe('blockApplicant2_name');
        expect(blockRefOf(doc.byId[id])?.prefix).toBe('blockApplicant2_');
        // the form's own field is untouched
        expect(doc.byId.name?.parentId).toBeUndefined();
    });
});

describe('a copy brought to a newer version', () => {
    it('takes the new fields, keeps a published key the new version leaves out as removed, and records the version', () => {
        const store = storeWith([]);
        const id = store.getState().actions.insertBlock(applicant(1)) ?? '';
        store.getState().actions.setPublished(new Map([['role', { key: 'role' } as never]]));
        const next = applicant(2, [f('name', 'InputText'), f('phone', 'InputText')]);
        expect(store.getState().actions.updateBlock(id, next)).toBe(true);
        const { doc } = store.getState();
        expect(doc.children[id]).toEqual(['name', 'phone', 'role']);
        expect(doc.byId.role?.removed).toBe(true);
        expect(blockRefOf(doc.byId[id])?.version).toBe(2);
    });

    it('is refused when a field an effect reads would leave, or for another block', () => {
        const store = storeWith([]);
        const id = store.getState().actions.insertBlock(applicant(1)) ?? '';
        store.getState().actions.setLocked(new Map([['role', { key: 'role' } as never]]));
        expect(store.getState().actions.updateBlock(id, applicant(2, [f('name', 'InputText')]))).toBe(false);
        expect(store.getState().actions.updateBlock(id, { ...applicant(2), key: 'block-vehicle' })).toBe(false);
        expect(blockRefOf(store.getState().doc.byId[id])?.version).toBe(1);
    });
});

describe('the block versions a stored document holds', () => {
    it('are read from the sections that name the block, once each, lowest first', () => {
        const doc = {
            fields: [
                { id: 'a', type: 'FormSection', props: { block: { key: 'block-vehicle', version: 3, prefix: '' } } },
                { id: 'b', type: 'FormSection', props: { block: { key: 'block-vehicle', version: 1, prefix: 'v2_' } } },
                { id: 'c', type: 'FormSection', props: { block: { key: 'block-payment', version: 2 } } },
                { id: 'd', type: 'FormSection', props: { block: { key: 'block-vehicle', version: 0 } } }
            ]
        };
        expect(blockUses(doc, 'block-vehicle')).toEqual([1, 3]);
        expect(blockUses(doc, 'block-applicant')).toEqual([]);
        expect(blockRefOf(doc.fields[2])).toEqual({ key: 'block-payment', version: 2, prefix: '' });
        expect(blockRefOf(doc.fields[3])).toBeNull();
    });
});
