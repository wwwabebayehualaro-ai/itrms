import type { FormField } from '@itrms/schemas';
import { describe, expect, it, vi } from 'vitest';
import '../renderer/fields/registerAll';
import { readDocument, untranslatedTexts } from '../core';
import { EMPTY_DOC, ROOT, fromStored, renameKey, toStored } from './document';
import { createDesignerStore } from './store';
import { amText } from '../test-utils';

/** A value the test has just made; its absence is a failure of the test. */
const must = <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) throw new Error('expected a value');
    return value;
};

const TEXT = 'form-engine.palette.type.InputText.label';

const f = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    data: { defaultProps: {} },
    layout: { options: { isContainer: ['Panel', 'FormArray'].includes(type) } },
    ...extra
});

const stored = [
    f('title', 'InputText'),
    f('box', 'Panel'),
    f('amount', 'InputNumber', { parentId: 'box' }),
    f('lines', 'FormArray', { parentId: 'box' }),
    f('qty', 'InputNumber', { parentId: 'lines' }),
    f('note', 'InputTextarea')
];

describe('designer document', () => {
    it('reads the stored flat list as a tree and writes it back unchanged', () => {
        const { doc, problems } = fromStored({ fields: stored, runtime: { dataSources: [] } });
        expect(problems).toEqual([]);
        expect(doc.children[ROOT]).toEqual(['title', 'box', 'note']);
        expect(doc.children.box).toEqual(['amount', 'lines']);
        const out = toStored(doc);
        expect(out.schemaVersion).toBe(2);
        expect(out.fields).toEqual(stored);
        // the engine sees the same form
        expect(readDocument(out).fields.map((x) => [x.id, x.parentId])).toEqual(
            readDocument(stored).fields.map((x) => [x.id, x.parentId])
        );
    });

    it('keeps what it cannot place and says so', () => {
        const { doc, problems } = fromStored([
            f('a', 'InputText', { parentId: 'gone' }),
            f('a', 'InputText'),
            { nope: 1 },
            f('p', 'Panel', { parentId: 'q' }),
            f('q', 'Panel', { parentId: 'p' })
        ]);
        expect(problems).toHaveLength(4);
        expect(doc.children[ROOT]).toEqual(expect.arrayContaining(['a']));
        expect(Object.keys(doc.byId).sort()).toEqual(['a', 'p', 'q']);
    });
});

describe('designer store', () => {
    const load = () => {
        const store = createDesignerStore();
        store.getState().actions.load(fromStored(stored).doc, { name: 'T', slug: 't', form_config: {} });
        return store;
    };

    it('adds from the palette next to the selection, with a readable unique key', () => {
        const store = load();
        const a = store.getState().actions;
        a.select('amount');
        const id = a.add('InputText', TEXT);
        expect(id).toBe('text');
        expect(store.getState().doc.children.box).toEqual(['amount', 'text', 'lines']);
        expect(store.getState().selected).toBe('text');
        a.select('lines');
        expect(a.add('InputText', TEXT)).toBe('text2');
        expect(store.getState().doc.children.lines).toEqual(['qty', 'text2']);
        expect(store.getState().doc.byId.text2?.parentId).toBe('lines');
    });

    it('moves, refuses a container into itself, nudges, duplicates and removes with the inside', () => {
        const store = load();
        const a = store.getState().actions;
        expect(a.move('box', 'lines', 0)).toBe(false);
        expect(a.move('note', 'box', 0)).toBe(true);
        expect(store.getState().doc.children.box).toEqual(['note', 'amount', 'lines']);
        a.nudge('note', 1);
        expect(store.getState().doc.children.box).toEqual(['amount', 'note', 'lines']);
        const copy = a.duplicate('lines');
        expect(copy).toBe('linesCopy');
        expect(store.getState().doc.children.linesCopy).toEqual(['qtyCopy']);
        a.remove('box');
        const { doc } = store.getState();
        expect(doc.children[ROOT]).toEqual(['title']);
        expect(Object.keys(doc.byId)).toEqual(['title']);
    });

    it('undoes and redoes; typing in one setting is one step; back at the saved state nothing is unsaved', () => {
        vi.useFakeTimers();
        const store = load();
        const a = store.getState().actions;
        const dirty = () => store.getState().doc !== store.getState().saved;
        for (const ch of ['T', 'Ti', 'Tit']) a.update('title', (x) => void (x.label = ch), 'label:title');
        expect(store.getState().past).toHaveLength(1);
        vi.advanceTimersByTime(2000);
        a.update('title', (x) => void (x.label = 'Title!'), 'label:title');
        expect(store.getState().past).toHaveLength(2);
        expect(dirty()).toBe(true);
        a.undo();
        expect(store.getState().doc.byId.title?.label).toBe('Tit');
        a.undo();
        expect(store.getState().doc.byId.title?.label).toBe('title');
        expect(dirty()).toBe(false);
        a.redo();
        expect(store.getState().doc.byId.title?.label).toBe('Tit');
        // an unchanged field keeps its object (its part of the canvas does not re-render)
        expect(store.getState().doc.byId.amount).toBe(store.getState().saved.byId.amount);
        vi.useRealTimers();
    });

    it('lets the key of a new field follow its label, never the key of a saved one', () => {
        const store = load();
        const a = store.getState().actions;
        const id = must(a.add('InputText', TEXT));
        for (const label of ['F', 'Fu', 'Full name']) a.relabel(must(store.getState().selected), label);
        expect(store.getState().selected).toBe('fullName');
        expect(store.getState().doc.byId.fullName?.label).toBe('Full name');
        expect(store.getState().doc.byId[id]).toBeUndefined();
        a.undo(); // the whole typing was one step
        expect(store.getState().doc.byId.text?.label).toBe(amText(TEXT)); // the builder writes Amharic, the key is English
        a.relabel('title', 'Trip title'); // saved with the form: its key stays
        expect(store.getState().doc.byId.title?.label).toBe('Trip title');
        a.select('note');
        a.relabel('note', 'Notes');
        expect(store.getState().doc.byId.note?.label).toBe('Notes');
    });

    it('lets a numbered key follow its label (text2 becomes phone)', () => {
        const store = load();
        const a = store.getState().actions;
        a.add('InputText', TEXT);
        const second = a.add('InputText', TEXT) ?? '';
        expect(second).toMatch(/^text\d+$/);
        a.relabel(second, 'Phone');
        expect(store.getState().doc.byId.phone?.label).toBe('Phone');
    });

    it('renames a key everywhere it is used', () => {
        const store = load();
        const a = store.getState().actions;
        a.update(
            'note',
            (x) =>
                void (x.behavior = {
                    visibilityConditions: [{ field: 'amount', operator: 'gt', value: 5 }]
                } as FormField['behavior'])
        );
        a.rename('amount', 'total');
        const { doc, selected } = store.getState();
        expect(doc.children.box).toEqual(['total', 'lines']);
        expect(doc.byId.note?.behavior?.visibilityConditions?.[0]?.field).toBe('total');
        expect(selected).toBe('total');
    });
});

describe('designer store: texts in a language', () => {
    const open = (language: string) => {
        const store = createDesignerStore(undefined, undefined, language);
        store.getState().actions.load(fromStored(stored).doc, { name: 'T', slug: 't', form_config: {} });
        return store;
    };

    it('writes the label in the builder language and keeps the other languages', () => {
        const store = open('en');
        const a = store.getState().actions;
        const id = must(a.add('InputText', TEXT));
        a.relabel(id, 'Full name');
        expect(store.getState().selected).toBe('fullName');
        a.setLanguage('am');
        expect(store.getState().past).toHaveLength(2); // adding, and typing the label; the switch is no step
        a.relabel('fullName', 'ሙሉ ስም');
        expect(store.getState().doc.byId.fullName?.label).toEqual({ en: 'Full name', am: 'ሙሉ ስም' });
        expect(store.getState().selected).toBe('fullName'); // an Amharic label never renames the key
        a.undo();
        // the palette text and the typed one are in the builder's language, on a form written in Amharic
        expect(store.getState().doc.byId.fullName?.label).toEqual({ en: 'Full name' });
    });

    it('does not rename the key of a new field from an Ethiopic label (it used to become f, f2)', () => {
        const store = open('am');
        const a = store.getState().actions;
        const id = must(a.add('InputText', TEXT));
        for (const label of ['ሙ', 'ሙሉ', 'ሙሉ ስም']) a.relabel(id, label);
        expect(store.getState().selected).toBe('text');
        expect(store.getState().doc.byId.text?.label).toBe('ሙሉ ስም');
        expect(store.getState().past).toHaveLength(2); // the typing is one step
    });

    it('writes a cell of the translation table in another language than the builder language', () => {
        const store = open('am');
        const a = store.getState().actions;
        a.relabel('title', 'ርዕስ', 'am');
        a.relabel('title', 'Title', 'en');
        expect(store.getState().doc.byId.title?.label).toEqual({ am: 'ርዕስ', en: 'Title' });
        expect(store.getState().language).toBe('am');
    });

    it('copies a map label per language', () => {
        const store = open('en');
        const a = store.getState().actions;
        a.update('title', (f) => void (f.label = { am: 'ርዕስ', en: 'Title' }));
        const copy = must(a.duplicate('title'));
        expect(store.getState().doc.byId[copy]?.label).toEqual({ am: 'ርዕስ (copy)', en: 'Title (copy)' });
    });

    it('gives a field labelled in Amharic first its key from the English label typed later', () => {
        const store = open('am');
        const a = store.getState().actions;
        const id = must(a.add('InputText', TEXT));
        for (const label of ['ሙ', 'ሙሉ', 'ሙሉ ስም']) a.relabel(id, label);
        expect(store.getState().selected).toBe('text');
        a.setLanguage('en');
        for (const label of ['F', 'Full', 'Full name']) a.relabel(must(store.getState().selected), label);
        expect(store.getState().selected).toBe('fullName');
        expect(store.getState().doc.byId.fullName?.label).toEqual({ am: 'ሙሉ ስም', en: 'Full name' });
        expect(store.getState().past).toHaveLength(3); // adding, the Amharic typing, the English typing
    });

    it('does not follow once the key was renamed by hand, nor on a saved field', () => {
        const store = open('en');
        const a = store.getState().actions;
        const id = must(a.add('InputText', TEXT));
        a.rename(id, 'myKey');
        a.relabel('myKey', 'Full name');
        expect(store.getState().selected).toBe('myKey');
        expect(store.getState().doc.byId.fullName).toBeUndefined();
        a.relabel('title', 'Heading');
        expect(store.getState().doc.byId.title?.label).toEqual({ am: 'title', en: 'Heading' });
        expect(store.getState().doc.byId.heading).toBeUndefined();
    });

    it('reads the same form the same way whatever the builder language is', () => {
        const form = {
            textLanguage: 'en',
            fields: [
                { ...stored[0], label: 'Title' },
                { ...stored[5], label: { en: 'Note' } }
            ]
        };
        const counts = ['am', 'en'].map((language) => {
            const store = createDesignerStore(undefined, undefined, language);
            store.getState().actions.load(fromStored(form).doc, { name: 'T', slug: 't', form_config: {} });
            const { doc } = store.getState();
            return [doc.textLanguage, untranslatedTexts(toStored(doc).fields, doc.textLanguage).length];
        });
        expect(counts[0]).toEqual(counts[1]);
        expect(counts[0]?.[0]).toBe('en');
        expect(counts[0]?.[1]).toBeGreaterThan(0);
    });

    it('keeps the text language through a rename and writes it', () => {
        const { doc } = fromStored({ fields: stored, textLanguage: 'en' });
        const renamed = renameKey(doc, 'note', 'remark');
        expect(renamed.textLanguage).toBe('en');
        expect(toStored(renamed).textLanguage).toBe('en');
        expect(toStored(EMPTY_DOC).textLanguage).toBe('am');
    });

    it('writes the palette text in the form language on a new form of the builder language', () => {
        const store = createDesignerStore({ ...EMPTY_DOC, textLanguage: 'en' }, undefined, 'en');
        const id = must(store.getState().actions.add('InputText', TEXT));
        expect(store.getState().doc.byId[id]?.label).toBe('Text');
        expect(store.getState().doc.textLanguage).toBe('en');
        store.getState().actions.setLanguage('am');
        const second = must(store.getState().actions.add('FormArray', 'form-engine.palette.type.FormArray.label'));
        const props = store.getState().doc.byId[second]?.props;
        expect(store.getState().doc.byId[second]?.label).toEqual({
            am: amText('form-engine.palette.type.FormArray.label')
        });
        // the row and button names are worded per reader, not stored
        expect(props).toEqual({ minItems: 1 });
    });
});

describe('designer store: published keys', () => {
    const published = new Map([
        ['title', { kind: 'text', scope: null, label: 'title', type: 'InputText' }],
        ['qty', { kind: 'number', scope: 'lines', label: 'qty', type: 'InputNumber' }]
    ]);
    const load = () => {
        const store = createDesignerStore();
        store.getState().actions.load(fromStored(stored).doc, { name: 'T', slug: 't', form_config: {} });
        store.getState().actions.setPublished(published);
        return store;
    };

    it('refuses to rename a published key and renames another', () => {
        const store = load();
        const a = store.getState().actions;
        a.rename('title', 'heading');
        expect(Object.keys(store.getState().doc.byId)).toContain('title');
        expect(Object.keys(store.getState().doc.byId)).not.toContain('heading');
        expect(store.getState().past).toHaveLength(0);
        a.rename('note', 'remark');
        expect(Object.keys(store.getState().doc.byId)).toContain('remark');
    });

    it('flags a published field removed instead of deleting it, and restores it', () => {
        const store = load();
        const a = store.getState().actions;
        a.remove('title');
        expect(store.getState().doc.byId.title?.removed).toBe(true);
        expect(store.getState().doc.children[ROOT]).toContain('title');
        a.restore('title');
        expect(store.getState().doc.byId.title?.removed).toBeUndefined();
        // a container that holds a published key is flagged too: its fields stay
        a.remove('box');
        expect(store.getState().doc.byId.box?.removed).toBe(true);
        expect(store.getState().doc.byId.qty).toBeDefined();
        // a field with no published key inside is deleted as before
        a.remove('note');
        expect(store.getState().doc.byId.note).toBeUndefined();
        a.undo();
        expect(store.getState().doc.byId.note).toBeDefined();
    });

    it('keeps the flag when saved: removed is part of the stored field', () => {
        const store = load();
        store.getState().actions.remove('title');
        const out = toStored(store.getState().doc);
        expect(out.fields.find((x) => x.id === 'title')?.removed).toBe(true);
        expect(readDocument(out).fields.find((x) => x.id === 'title')?.removed).toBe(true);
    });
});

describe('designer store: fields an effect reads (task 0.21d)', () => {
    const load = () => {
        const store = createDesignerStore();
        store.getState().actions.load(fromStored(stored).doc, { name: 'T', slug: 't', form_config: {} });
        store
            .getState()
            .actions.setLocked(
                new Map([
                    ['title', { key: 'title', kind: 'text', required: true, effects: ['x.y'], services: ['RS-01'] }]
                ])
            );
        return store;
    };

    it('keeps a locked field: its key, its type, its required-ness, its place at the top level', () => {
        const store = load();
        const a = store.getState().actions;
        a.rename('title', 'heading');
        expect(store.getState().doc.byId.title).toBeDefined();
        a.remove('title');
        expect(store.getState().doc.byId.title?.removed).toBeUndefined();
        expect(store.getState().doc.children[ROOT]).toContain('title');
        // its label may change; its type and required-ness stay
        a.update('title', (f) => {
            f.type = 'InputNumber';
            f.label = 'Heading';
            f.props = { ...(f.props ?? {}), required: false };
        });
        const title = store.getState().doc.byId.title;
        expect(title?.type).toBe('InputText');
        expect(title?.label).toBe('Heading');
        expect(title?.props?.required).toBe(true);
        // never into a repeating section (its value would be a row's)
        expect(a.move('title', 'lines', 0)).toBe(false);
        expect(a.move('title', 'box', 0)).toBe(true);
    });
});

describe('designer store: a locked field keeps what an effect relies on (review of 0.21d)', () => {
    it('keeps its kind settings, gets no condition or role, and is not dropped by a restored version', () => {
        const store = createDesignerStore();
        store.getState().actions.load(fromStored(stored).doc, { name: 'T', slug: 't', form_config: {} });
        store
            .getState()
            .actions.setLocked(
                new Map([
                    ['title', { key: 'title', kind: 'text', required: true, effects: ['x.y'], services: ['RS-01'] }]
                ])
            );
        const a = store.getState().actions;
        a.update('title', (f) => {
            f.visibleToRoles = ['bureau_admin'];
            f.behavior = {
                ...(f.behavior ?? {}),
                visibilityConditions: [{ field: 'note', operator: 'eq', value: 'x' }]
            };
        });
        const title = store.getState().doc.byId.title;
        expect(title?.visibleToRoles).toBeUndefined();
        expect(title?.behavior?.visibilityConditions).toBeUndefined();
        // a version without the field is not taken in
        const before = store.getState().doc;
        a.replace(fromStored(stored.filter((x) => x.id !== 'title')).doc);
        expect(store.getState().doc).toBe(before);
    });
});
