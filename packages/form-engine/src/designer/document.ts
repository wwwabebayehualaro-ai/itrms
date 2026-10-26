/**
 * The form as the builder edits it: fields by id plus the ordered children of every container (`ROOT` = the top level). UI-free.
 *
 * Stored `form_config` stays the contract the backend and both renderers read: a flat list of fields linked by `parentId`, plus
 * `runtime`. `fromStored` builds the tree from any stored version; `toStored` writes it back depth-first (parents before their
 * children, siblings in their order) with `schemaVersion: 2`. Every key of a field the builder does not know is kept as it was.
 */
import type { Draft } from 'immer';
import { formTextIn, setTextIn, textLanguageOf, textPropsOf, type FormField, type FormText } from '@itrms/schemas';
import { getFieldType } from '../renderer/kit';
import { wordIn, type EngineWord } from '../core/messages';
import { keyFromLabel, renameFieldKey, renameInRuntime } from './fieldKeys';
import { SCHEMA_VERSION } from '../core';
import { EMPTY_RUNTIME, type TemplateRuntimeConfig } from '@itrms/schemas';

export const ROOT = '';

/**
 * The text a key or an address is made from: the English text of a map, else a plain string (older forms). An
 * Ethiopic text has no letters to make one from, so its key is made when the English one is written.
 */
export const keySourceOf = (text: FormText | null | undefined): string =>
    typeof text === 'string' ? text : typeof text?.en === 'string' ? text.en : '';

/** A form's address from its name ("Leave request" -> leave-request). */
export const slugify = (name: FormText) =>
    keySourceOf(name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

export interface DesignDoc {
    byId: Record<string, FormField>;
    /** Ordered child ids per container id (`ROOT` for the top level). */
    children: Record<string, string[]>;
    runtime: TemplateRuntimeConfig;
    /** The language the form's plain-string texts are written in (stored with the form, fixed for its life). */
    textLanguage: string;
}

// a type, not an interface: it is a `form_config` (a Record), which an interface is not assignable to
export type StoredDocument = {
    schemaVersion: number;
    fields: FormField[];
    runtime: TemplateRuntimeConfig;
    textLanguage: string;
};

export const EMPTY_DOC: DesignDoc = { byId: {}, children: { [ROOT]: [] }, runtime: EMPTY_RUNTIME, textLanguage: 'am' };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

const isRuntime = (r: unknown): r is TemplateRuntimeConfig =>
    !!r && typeof r === 'object' && Array.isArray((r as TemplateRuntimeConfig).dataSources);

/** Any stored `form_config` (a bare field list, `{ fields, runtime }`, a versioned document) -> the builder's document. */
export function fromStored(
    config: unknown,
    runtimeOverride?: TemplateRuntimeConfig
): { doc: DesignDoc; problems: string[] } {
    const raw = Array.isArray(config)
        ? config
        : config && typeof config === 'object'
          ? ((config as { fields?: unknown }).fields ?? [])
          : [];
    const runtime =
        runtimeOverride ??
        (config &&
        typeof config === 'object' &&
        !Array.isArray(config) &&
        isRuntime((config as { runtime?: unknown }).runtime)
            ? (config as { runtime: TemplateRuntimeConfig }).runtime
            : EMPTY_RUNTIME);
    const problems: string[] = [];
    const byId: Record<string, FormField> = {};
    const order: string[] = [];
    (Array.isArray(raw) ? (raw as unknown[]) : []).forEach((f, i) => {
        if (!isRecord(f) || (typeof f.id !== 'string' && typeof f.id !== 'number') || typeof f.type !== 'string')
            return problems.push(`Field ${i + 1} cannot be read and was left out`);
        const id = String(f.id);
        if (byId[id]) return problems.push(`A second field with the key "${id}" was left out`);
        byId[id] = { ...(f as FormField), id };
        order.push(id);
    });
    const parentOf = (id: string): string => {
        const p = byId[id]?.parentId;
        if (p === undefined || p === null || p === '') return ROOT;
        const pid = String(p);
        if (!byId[pid] || pid === id) return ROOT;
        // a parent chain that loops back is cut at the top level
        for (let cur: string | undefined = pid, guard = 0; cur && guard < 1000; guard++) {
            if (cur === id) return ROOT;
            const up: FormField['parentId'] = byId[cur]?.parentId;
            cur = up === undefined || up === null || up === '' ? undefined : String(up);
        }
        return pid;
    };
    const children: Record<string, string[]> = { [ROOT]: [] };
    for (const id of order) {
        const parent = parentOf(id);
        const f = byId[id];
        if (f && parent === ROOT && f.parentId) {
            problems.push(
                `"${formTextIn(f.label, 'en') || id}" pointed at a missing container and was moved to the top level`
            );
            delete f.parentId;
        }
        (children[parent] ??= []).push(id);
    }
    return { doc: { byId, children, runtime, textLanguage: textLanguageOf(config) }, problems };
}

/** The builder's document -> what is stored (`form_config`). */
export function toStored(doc: DesignDoc): StoredDocument {
    const fields: FormField[] = [];
    const visit = (parent: string) =>
        (doc.children[parent] ?? []).forEach((id) => {
            const f = doc.byId[id];
            if (!f) return;
            fields.push(f);
            visit(id);
        });
    visit(ROOT);
    return { schemaVersion: SCHEMA_VERSION, fields, runtime: doc.runtime, textLanguage: doc.textLanguage };
}

// ---- queries ----------------------------------------------------------------------------------------------------------
export const parentOf = (doc: DesignDoc, id: string): string => {
    const p = doc.byId[id]?.parentId;
    return p === undefined || p === null || p === '' ? ROOT : String(p);
};
export const siblingsOf = (doc: DesignDoc, id: string) => doc.children[parentOf(doc, id)] ?? [];

/** `id` and every field inside it, depth-first. */
export function subtree(doc: DesignDoc, id: string): string[] {
    const out = [id];
    for (const c of doc.children[id] ?? []) out.push(...subtree(doc, c));
    return out;
}

export const isContainer = (f: FormField | undefined) => !!f?.layout?.options?.isContainer;

/** May `type` go into `parent`? (`acceptsChildren` lists allowed types; none, or '*', allows any.) */
export function accepts(doc: DesignDoc, parent: string, type: string): boolean {
    if (parent === ROOT) return true;
    const p = doc.byId[parent];
    if (!p || !isContainer(p)) return false;
    const list = p.layout?.options?.acceptsChildren;
    return !list || list.length === 0 || list.includes('*') || list.includes(type);
}

/** A key nobody uses yet, from a label ("Unit price" -> unitPrice, unitPrice2, ...). */
export function uniqueKey(
    doc: DesignDoc,
    label: FormText | undefined,
    taken: Set<string> = new Set(Object.keys(doc.byId))
): string {
    const base = keyFromLabel(keySourceOf(label) || 'field') || 'field';
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
    taken.add(key);
    return key;
}

// ---- new fields -------------------------------------------------------------------------------------------------------
/**
 * A new field of `type`, as the field kit describes it: a readable key from its label, the type's starting settings, and what
 * the engine needs to place it (`category`: a value, a container or data; `layout.options.isContainer`). Choices start with two
 * options whose stored values follow their labels.
 */
export function createField(
    doc: DesignDoc,
    type: string,
    label: EngineWord,
    language: string = doc.textLanguage
): FormField | null {
    const def = getFieldType(type);
    if (!def?.design) return null;
    // the palette's texts are in the builder's language: plain on a form edited in its own language, else a map
    const asText = (text: string): FormText | undefined => setTextIn(undefined, language, text, doc.textLanguage);
    const shown = wordIn(language, label);
    // a key is English even when the builder writes Amharic
    const id = uniqueKey(doc, wordIn('en', label));
    const isContainer = (def.kind === 'container' || def.kind === 'section') && !def.design.leaf;
    const field: FormField = {
        id,
        type,
        label: asText(shown) ?? shown,
        category: def.kind === 'value' ? 'Input' : def.kind === 'display' ? 'Data' : 'Layout',
        props: { ...(def.design.defaults ?? {}) },
        data: { defaultProps: {} },
        behavior: def.kind === 'value' ? { validation: { supported: true } } : {},
        layout: { options: { isContainer } }
    };
    for (const key of textPropsOf(type)) {
        const value = field.props[key];
        if (typeof value === 'string') field.props[key] = asText(value);
    }
    if (def.design.options)
        field.data = {
            ...field.data,
            dataSource: {
                staticData: [
                    {
                        label: asText(wordIn(language, 'form-engine.palette.defaults.option', { n: '1' })),
                        value: 'option_1'
                    },
                    {
                        label: asText(wordIn(language, 'form-engine.palette.defaults.option', { n: '2' })),
                        value: 'option_2'
                    }
                ]
            }
        };
    return field;
}

// ---- edits (immer recipes) -----------------------------------------------------------------------------------------------
type D = Draft<DesignDoc>;

const detach = (d: D, id: string) => {
    const parent = parentOf(d, id);
    const list = d.children[parent];
    const at = list ? list.indexOf(id) : -1;
    if (list && at >= 0) list.splice(at, 1);
    return { parent, at };
};

const attach = (d: D, id: string, parent: string, index: number) => {
    const list = (d.children[parent] ??= []);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
    const f = d.byId[id];
    if (!f) return;
    if (parent === ROOT) delete f.parentId;
    else f.parentId = parent;
};

export function insertField(d: D, field: FormField, parent: string, index: number) {
    d.byId[field.id] = field;
    if (field.layout?.options?.isContainer) d.children[field.id] ??= [];
    attach(d, field.id, parent, index);
}

/** Move `id` to `index` of `parent`'s children. Refused (false) into itself, its own inside or a container that does not take it. */
export function moveField(d: D, id: string, parent: string, index: number): boolean {
    const doc = d as DesignDoc;
    if (
        !doc.byId[id] ||
        (parent !== ROOT && subtree(doc, id).includes(parent)) ||
        !accepts(doc, parent, doc.byId[id].type)
    )
        return false;
    const from = detach(d, id);
    attach(d, id, parent, from.parent === parent && from.at >= 0 && from.at < index ? index - 1 : index);
    return true;
}

export function removeField(d: D, id: string) {
    const all = subtree(d, id);
    detach(d, id);
    for (const x of all) {
        delete d.byId[x];
        delete d.children[x];
    }
}

/** A label for a copy: " (copy)" after the text of every language. */
const copyLabel = (label: FormText | undefined): FormText | undefined =>
    typeof label === 'string'
        ? `${label} (copy)`
        : label && Object.fromEntries(Object.entries(label).map(([tag, text]) => [tag, `${text} (copy)`]));

/** Copy of `id` and everything inside it, right after it; the copies get new unique keys. Returns the copy's id. */
export function duplicateField(d: D, id: string): string | null {
    const doc = d as DesignDoc;
    if (!doc.byId[id]) return null;
    const taken = new Set(Object.keys(doc.byId));
    const ids = subtree(doc, id);
    const map = new Map(ids.map((x) => [x, uniqueKey(doc, `${x} copy`, taken)]));
    const copy = (x: string): FormField => {
        const src = JSON.parse(JSON.stringify(doc.byId[x])) as FormField;
        const nid = map.get(x) ?? x;
        return {
            ...src,
            id: nid,
            label: x === id ? copyLabel(src.label) : src.label,
            props: { ...src.props, ...(src.props?.id !== undefined && { id: nid }) },
            data: src.data && {
                ...src.data,
                defaultProps: { ...src.data.defaultProps, ...(src.data.defaultProps?.id !== undefined && { id: nid }) }
            }
        };
    };
    const { parent, at } = { parent: parentOf(doc, id), at: siblingsOf(doc, id).indexOf(id) };
    const place = (x: string, into: string, index: number) => {
        insertField(d, copy(x), into, index);
        (doc.children[x] ?? []).forEach((c, i) => place(c, map.get(x) ?? x, i));
    };
    place(id, parent, at + 1);
    return map.get(id) ?? id;
}

/** Rename a field's key everywhere it is used (children, conditions, formulas, bindings, data sources). */
export function renameKey(doc: DesignDoc, oldKey: string, newKey: string): DesignDoc {
    const stored = toStored(doc);
    const fields = renameFieldKey(stored.fields, oldKey, newKey).map((f) =>
        f.id === newKey
            ? {
                  ...f,
                  props: { ...f.props, ...(f.props?.id !== undefined && { id: newKey }) },
                  data: f.data && {
                      ...f.data,
                      defaultProps: {
                          ...f.data.defaultProps,
                          ...(f.data.defaultProps?.id !== undefined && { id: newKey })
                      }
                  }
              }
            : f
    );
    const renamed = fromStored(
        { fields, textLanguage: doc.textLanguage },
        renameInRuntime(doc.runtime, oldKey, newKey)
    );
    return renamed.doc;
}

/** Set (or, with `undefined`, remove) the value at a dotted path inside a field draft, creating objects on the way. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown) {
    const keys = path.split('.');
    let o = target;
    for (const k of keys.slice(0, -1)) {
        let next = o[k];
        if (!isRecord(next)) o[k] = next = {};
        o = next as Record<string, unknown>;
    }
    const last = keys[keys.length - 1] ?? '';
    if (value === undefined) delete o[last];
    else o[last] = value;
}

export const getPath = (target: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), target);

/**
 * Write one text of a field draft (a dotted path) in a language; the other languages' texts stay. A text left empty is
 * removed, but written as '' over a palette default (which a removed one would bring back). Returns what was stored.
 */
export function writeText(
    field: Draft<FormField>,
    path: string,
    language: string,
    value: string,
    plainAs: string
): FormText | undefined {
    const target: Record<string, unknown> = field;
    const inherited = path.startsWith('props.') ? field.data?.defaultProps?.[path.slice(6)] : undefined;
    const next = setTextIn(getPath(target, path) ?? inherited, language, value, plainAs);
    setPath(target, path, next === undefined && inherited !== undefined ? '' : next);
    return next;
}
