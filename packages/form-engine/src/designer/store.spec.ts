import { describe, expect, it, vi } from 'vitest';
import '../renderer/fields/registerAll';
import { readDocument } from '../core';
import { ROOT, fromStored, toStored } from './document';
import { createDesignerStore } from './store';

const f = (id: string, type: string, extra: Record<string, any> = {}) => ({
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
        const id = a.add('InputText', 'Text');
        expect(id).toBe('text');
        expect(store.getState().doc.children.box).toEqual(['amount', 'text', 'lines']);
        expect(store.getState().selected).toBe('text');
        a.select('lines');
        expect(a.add('InputText', 'Text')).toBe('text2');
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
        const id = a.add('InputText', 'Text')!;
        for (const label of ['F', 'Fu', 'Full name']) a.relabel(store.getState().selected!, label);
        expect(store.getState().selected).toBe('fullName');
        expect(store.getState().doc.byId.fullName?.label).toBe('Full name');
        expect(store.getState().doc.byId[id]).toBeUndefined();
        a.undo(); // the whole typing was one step
        expect(store.getState().doc.byId.text?.label).toBe('Text');
        a.relabel('title', 'Trip title'); // saved with the form: its key stays
        expect(store.getState().doc.byId.title?.label).toBe('Trip title');
        a.select('note');
        a.relabel('note', 'Notes');
        expect(store.getState().doc.byId.note?.label).toBe('Notes');
    });

    it('lets a numbered key follow its label (text2 becomes phone)', () => {
        const store = load();
        const a = store.getState().actions;
        a.add('InputText', 'Text');
        const second = a.add('InputText', 'Text') ?? '';
        expect(second).toMatch(/^text\d+$/);
        a.relabel(second, 'Phone');
        expect(store.getState().doc.byId.phone?.label).toBe('Phone');
    });

    it('renames a key everywhere it is used', () => {
        const store = load();
        const a = store.getState().actions;
        a.update(
            'note',
            (x) => void (x.behavior = { visibilityConditions: [{ field: 'amount', operator: 'gt', value: 5 }] } as any)
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
        const id = a.add('InputText', 'Text')!;
        a.relabel(id, 'Full name');
        expect(store.getState().selected).toBe('fullName');
        a.setLanguage('am');
        expect(store.getState().past).toHaveLength(2); // adding, and typing the label; the switch is no step
        a.relabel('fullName', 'ሙሉ ስም');
        expect(store.getState().doc.byId.fullName?.label).toEqual({ en: 'Full name', am: 'ሙሉ ስም' });
        expect(store.getState().selected).toBe('fullName'); // an Amharic label never renames the key
        a.undo();
        expect(store.getState().doc.byId.fullName?.label).toBe('Full name');
    });

    it('does not rename the key of a new field from an Ethiopic label (it used to become f, f2)', () => {
        const store = open('am');
        const a = store.getState().actions;
        const id = a.add('InputText', 'Text')!;
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
        const copy = a.duplicate('title')!;
        expect(store.getState().doc.byId[copy]?.label).toEqual({ am: 'ርዕስ (copy)', en: 'Title (copy)' });
    });
});
