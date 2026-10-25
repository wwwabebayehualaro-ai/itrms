'use client';

/**
 * State of one form builder: the document, its history (undo/redo), what is selected and what was last saved. A small Zustand
 * store per builder (tests and two builders on a page never share state); edits are immer recipes over the document, so an
 * unchanged field keeps its object and its part of the canvas does not re-render.
 *
 * History: every edit is one step, except a run of edits with the same `key` (typing in one setting) less than 1.5 s apart,
 * which is one step. "Unsaved changes" is `doc !== saved`: undoing back to the saved document is not a change.
 */
import { createContext, useContext } from 'react';
import { produce, type Draft } from 'immer';
import { createStore, useStore, type StoreApi } from 'zustand';
import { setTextIn, type FormField, type FormTemplate } from '@itrms/schemas';
import type { TemplateRuntimeConfig } from '@itrms/schemas';
import { keyFromLabel } from './fieldKeys';
import {
    EMPTY_DOC,
    ROOT,
    createField,
    duplicateField,
    insertField,
    keySourceOf,
    moveField,
    parentOf,
    removeField,
    renameKey,
    siblingsOf,
    subtree,
    uniqueKey,
    type DesignDoc
} from './document';

const HISTORY = 100;
const COALESCE_MS = 1500;

export interface DesignerState {
    doc: DesignDoc;
    saved: DesignDoc;
    past: DesignDoc[];
    future: DesignDoc[];
    lastEdit: { key: string; at: number } | null;
    selected: string | null;
    /** Changes when a different field is selected (not when the selected field's key is renamed): the inspector remounts on it. */
    selection: number;
    template: FormTemplate;
    /** The language the builder writes texts in. Not part of the document: switching it is not an undo step. */
    language: string;
    /** The language a plain-string text was written in (the page's language the session started in): fixed. */
    plainAs: string;
}

export interface DesignerActions {
    /** Replace everything (a form was opened): no history, nothing unsaved. */
    load: (doc: DesignDoc, template: FormTemplate) => void;
    /** One edit of the document. Edits with the same `key` in quick succession are one undo step. */
    edit: (recipe: (d: Draft<DesignDoc>) => void, key?: string) => void;
    add: (type: string, label: string, target?: { parent: string; index: number }) => string | null;
    move: (id: string, parent: string, index: number) => boolean;
    /** One place up / down among its siblings. */
    nudge: (id: string, by: -1 | 1) => void;
    remove: (id: string) => void;
    duplicate: (id: string) => string | null;
    update: (id: string, recipe: (f: Draft<FormField>) => void, key?: string) => void;
    rename: (id: string, newKey: string) => void;
    /**
     * Change a field's label in the builder's language. A field added since the last save whose key still follows its
     * English label gets a key from the new English label (never from a text without letters, such as an Amharic one).
     * `language`: another language than the builder's (the translation table's cells).
     */
    relabel: (id: string, text: string, language?: string) => void;
    setLanguage: (language: string) => void;
    setRuntime: (runtime: TemplateRuntimeConfig) => void;
    select: (id: string | null) => void;
    undo: () => void;
    redo: () => void;
    /** `doc` is what was sent (edits made while saving stay unsaved). */
    markSaved: (template: FormTemplate, doc?: DesignDoc) => void;
}

export type DesignerStore = StoreApi<DesignerState & { actions: DesignerActions }>;

const BLANK: FormTemplate = { name: '', slug: '', form_config: {} };

export function createDesignerStore(
    doc: DesignDoc = EMPTY_DOC,
    template: FormTemplate = BLANK,
    language = 'am'
): DesignerStore {
    return createStore<DesignerState & { actions: DesignerActions }>()((set, get) => {
        const commit = (next: DesignDoc, key?: string, selected?: string | null, renamed = false) => {
            const s = get();
            if (next === s.doc) return;
            const now = Date.now();
            const merge = !!key && s.lastEdit?.key === key && now - s.lastEdit.at < COALESCE_MS;
            set({
                doc: next,
                past: merge ? s.past : [...s.past, s.doc].slice(-HISTORY),
                future: [],
                lastEdit: key ? { key, at: now } : null,
                ...(selected !== undefined && { selected, selection: renamed ? s.selection : s.selection + 1 })
            });
        };
        const edit = (recipe: (d: Draft<DesignDoc>) => void, key?: string, selected?: string | null) =>
            commit(produce(get().doc, recipe), key, selected);
        // the last label edit: its field after the edit (the key may have changed) and its undo-step key
        let run: { id: string; key: string; language: string } | null = null;
        const keepSelection = (doc: DesignDoc, id: string | null) => (id && doc.byId[id] ? id : null);

        const actions: DesignerActions = {
            load: (d, t) =>
                set((s) => ({
                    doc: d,
                    saved: d,
                    past: [],
                    future: [],
                    lastEdit: null,
                    selected: null,
                    selection: s.selection + 1,
                    template: t
                })),
            edit: (recipe, key) => edit(recipe, key),
            add: (type, label, target) => {
                const { doc, selected } = get();
                const field = createField(doc, type, label);
                if (!field) return null;
                // where: the given place, else into the selected container, else after the selected field, else at the end
                let where = target;
                if (!where && selected && doc.byId[selected]) {
                    const sel = doc.byId[selected];
                    if (sel.layout?.options?.isContainer)
                        where = { parent: selected, index: (doc.children[selected] ?? []).length };
                    else
                        where = {
                            parent: parentOf(doc, selected),
                            index: siblingsOf(doc, selected).indexOf(selected) + 1
                        };
                }
                where ??= { parent: ROOT, index: (doc.children[ROOT] ?? []).length };
                const parent = where.parent;
                const p = doc.byId[parent];
                const allowed =
                    parent === ROOT ||
                    (p?.layout?.options?.isContainer &&
                        (!p.layout.options.acceptsChildren?.length ||
                            p.layout.options.acceptsChildren.includes('*') ||
                            p.layout.options.acceptsChildren.includes(type)));
                const final = allowed ? where : { parent: ROOT, index: (doc.children[ROOT] ?? []).length };
                edit((d) => insertField(d, field, final.parent, final.index), undefined, field.id);
                return field.id;
            },
            move: (id, parent, index) => {
                let ok = false;
                edit((d) => {
                    ok = moveField(d, id, parent, index);
                });
                return ok;
            },
            nudge: (id, by) => {
                const { doc } = get();
                const list = siblingsOf(doc, id);
                const at = list.indexOf(id);
                const to = at + by;
                if (at < 0 || to < 0 || to >= list.length) return;
                edit((d) => {
                    moveField(d, id, parentOf(doc, id), by > 0 ? to + 1 : to);
                });
            },
            remove: (id) => {
                const { doc, selected } = get();
                if (!doc.byId[id]) return;
                const list = siblingsOf(doc, id);
                const at = list.indexOf(id);
                // the selection moves to the next field (or the previous, or the container) so Delete can be pressed again
                const next = list[at + 1] ?? list[at - 1] ?? (parentOf(doc, id) || null);
                edit(
                    (d) => removeField(d, id),
                    undefined,
                    selected && subtree(doc, id).includes(selected) ? next : selected
                );
            },
            duplicate: (id) => {
                let copy: string | null = null;
                edit((d) => {
                    copy = duplicateField(d, id);
                });
                if (copy) set((s) => ({ selected: copy, selection: s.selection + 1 }));
                return copy;
            },
            update: (id, recipe, key) =>
                edit(
                    (d) => {
                        const f = d.byId[id];
                        if (f) recipe(f);
                    },
                    key ?? `field:${id}`
                ),
            rename: (id, newKey) => {
                const { doc } = get();
                if (!doc.byId[id] || id === newKey) return;
                commit(renameKey(doc, id, newKey), undefined, newKey, true);
            },
            relabel: (id, text, lang) => {
                const { doc, saved, plainAs } = get();
                const language = lang ?? get().language;
                const f = doc.byId[id];
                if (!f) return;
                const label = setTextIn(f.label, language, text, plainAs);
                let next = produce(doc, (d) => {
                    const draft = d.byId[id];
                    if (!draft) return;
                    if (label === undefined) delete draft.label;
                    else draft.label = label;
                });
                let selectedId = id;
                const base = keyFromLabel(keySourceOf(f.label));
                const follows =
                    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- a fixed digits-only pattern (linear time)
                    !saved.byId[id] && (id === base || (id.startsWith(base) && /^\d+$/.test(id.slice(base.length))));
                const source = keySourceOf(label);
                if (follows && /[A-Za-z]/.test(source) && source !== keySourceOf(f.label)) {
                    const taken = new Set(Object.keys(doc.byId).filter((k) => k !== id));
                    const key = uniqueKey(next, label, taken);
                    if (key !== id) {
                        next = renameKey(next, id, key);
                        selectedId = key;
                    }
                }
                // typing one label is one undo step, even while its key follows along
                // (the field's key changes along the way, so the run is followed by the key it ended on)
                const key = run?.id === id && run.language === language ? run.key : `label:${selectedId}:${language}`;
                run = { id: selectedId, key, language };
                // the selection follows the key; another field's label edited from the translation table leaves it
                commit(next, key, get().selected === id ? selectedId : undefined, true);
            },
            setLanguage: (language) => set((s) => (s.language === language ? s : { language })),
            setRuntime: (runtime) =>
                edit((d) => {
                    d.runtime = runtime;
                }, 'runtime'),
            select: (id) => set((s) => (s.selected === id ? s : { selected: id, selection: s.selection + 1 })),
            undo: () => {
                const s = get();
                const prev = s.past[s.past.length - 1];
                if (!prev) return;
                set({
                    doc: prev,
                    past: s.past.slice(0, -1),
                    future: [s.doc, ...s.future],
                    lastEdit: null,
                    selected: keepSelection(prev, s.selected),
                    selection: s.selection + 1
                });
            },
            redo: () => {
                const s = get();
                const next = s.future[0];
                if (!next) return;
                set({
                    doc: next,
                    past: [...s.past, s.doc],
                    future: s.future.slice(1),
                    lastEdit: null,
                    selected: keepSelection(next, s.selected),
                    selection: s.selection + 1
                });
            },
            markSaved: (t, sent) => set((s) => ({ saved: sent ?? s.doc, template: t, lastEdit: null }))
        };
        return {
            doc,
            saved: doc,
            past: [],
            future: [],
            lastEdit: null,
            selected: null,
            selection: 0,
            template,
            language,
            plainAs: language,
            actions
        };
    });
}

const Ctx = createContext<DesignerStore | null>(null);
export const DesignerProvider = Ctx.Provider;

function useDesignerStore(): DesignerStore {
    const store = useContext(Ctx);
    if (!store) throw new Error('useDesigner must be used inside <DesignerProvider>');
    return store;
}

/** Read part of the builder state; the component re-renders only when that part changes. */
export const useDesigner = <T>(select: (s: DesignerState) => T): T => useStore(useDesignerStore(), select);
export const useDesignerActions = (): DesignerActions => useStore(useDesignerStore(), (s) => s.actions);
export const useDesignerApi = useDesignerStore;
