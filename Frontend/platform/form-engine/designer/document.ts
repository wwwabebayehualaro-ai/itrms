/**
 * The form as the builder edits it: fields by id plus the ordered children of every container (`ROOT` = the top level). UI-free.
 *
 * Stored `form_config` stays the contract the backend and both renderers read: a flat list of fields linked by `parentId`, plus
 * `runtime`. `fromStored` builds the tree from any stored version; `toStored` writes it back depth-first (parents before their
 * children, siblings in their order) with `schemaVersion: 2`. Every key of a field the builder does not know is kept as it was.
 */
import type { Draft } from 'immer';
import type { FormField } from '../core/storedTypes';
import { getFieldType } from '../renderer/kit';
import { keyFromLabel, renameFieldKey, renameInRuntime } from './fieldKeys';
import { SCHEMA_VERSION } from '../core';
import { EMPTY_RUNTIME, type TemplateRuntimeConfig } from '../Runtime/types';

export const ROOT = '';

/** A form's address from its name ("Leave request" -> leave-request). */
export const slugify = (name: string) =>
    name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

export interface DesignDoc {
    byId: Record<string, FormField>;
    /** Ordered child ids per container id (`ROOT` for the top level). */
    children: Record<string, string[]>;
    runtime: TemplateRuntimeConfig;
}

export interface StoredDocument {
    schemaVersion: number;
    fields: FormField[];
    runtime: TemplateRuntimeConfig;
}

export const EMPTY_DOC: DesignDoc = { byId: {}, children: { [ROOT]: [] }, runtime: EMPTY_RUNTIME };

const isRuntime = (r: unknown): r is TemplateRuntimeConfig => !!r && typeof r === 'object' && Array.isArray((r as TemplateRuntimeConfig).dataSources);

/** Any stored `form_config` (a bare field list, `{ fields, runtime }`, a versioned document) -> the builder's document. */
export function fromStored(config: unknown, runtimeOverride?: TemplateRuntimeConfig): { doc: DesignDoc; problems: string[] } {
    const raw = Array.isArray(config) ? config : config && typeof config === 'object' ? ((config as { fields?: unknown }).fields ?? []) : [];
    const runtime = runtimeOverride ?? (config && typeof config === 'object' && !Array.isArray(config) && isRuntime((config as { runtime?: unknown }).runtime) ? (config as { runtime: TemplateRuntimeConfig }).runtime : EMPTY_RUNTIME);
    const problems: string[] = [];
    const byId: Record<string, FormField> = {};
    const order: string[] = [];
    (Array.isArray(raw) ? raw : []).forEach((f, i) => {
        if (!f || typeof f !== 'object' || (typeof f.id !== 'string' && typeof f.id !== 'number') || typeof f.type !== 'string') return problems.push(`Field ${i + 1} cannot be read and was left out`);
        const id = String(f.id);
        if (byId[id]) return problems.push(`A second field with the key "${id}" was left out`);
        byId[id] = { ...(f as FormField), id };
        order.push(id);
    });
    const parentOf = (id: string): string => {
        const p = byId[id].parentId;
        if (p === undefined || p === null || p === '') return ROOT;
        const pid = String(p);
        if (!byId[pid] || pid === id) return ROOT;
        // a parent chain that loops back is cut at the top level
        for (let cur: string | undefined = pid, guard = 0; cur && guard < 1000; guard++) {
            if (cur === id) return ROOT;
            const up: unknown = byId[cur].parentId;
            cur = up === undefined || up === null || up === '' ? undefined : String(up);
        }
        return pid;
    };
    const children: Record<string, string[]> = { [ROOT]: [] };
    for (const id of order) {
        const parent = parentOf(id);
        if (parent === ROOT && byId[id].parentId) {
            problems.push(`"${byId[id].label || id}" pointed at a missing container and was moved to the top level`);
            delete byId[id].parentId;
        }
        (children[parent] ??= []).push(id);
    }
    return { doc: { byId, children, runtime }, problems };
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
    return { schemaVersion: SCHEMA_VERSION, fields, runtime: doc.runtime };
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
    if (!isContainer(p)) return false;
    const list = p.layout?.options?.acceptsChildren as string[] | undefined;
    return !list || list.length === 0 || list.includes('*') || list.includes(type);
}

/** A key nobody uses yet, from a label ("Unit price" -> unitPrice, unitPrice2, ...). */
export function uniqueKey(doc: DesignDoc, label: string, taken: Set<string> = new Set(Object.keys(doc.byId))): string {
    const base = keyFromLabel(label || 'field') || 'field';
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
export function createField(doc: DesignDoc, type: string, label: string): FormField | null {
    const def = getFieldType(type);
    if (!def?.design) return null;
    const id = uniqueKey(doc, label);
    const isContainer = (def.kind === 'container' || def.kind === 'section') && !def.design.leaf;
    const field: FormField = {
        id,
        type,
        label,
        category: def.kind === 'value' ? 'Input' : def.kind === 'display' ? 'Data' : 'Layout',
        props: { ...(def.design.defaults ?? {}) },
        data: { defaultProps: {} },
        behavior: def.kind === 'value' ? { validation: { supported: true } } : {},
        layout: { options: { isContainer } }
    } as FormField;
    if (def.design.options) field.data!.dataSource = { staticData: [{ label: 'Option 1', value: 'option_1' }, { label: 'Option 2', value: 'option_2' }] } as never;
    return field;
}

// ---- edits (immer recipes) -----------------------------------------------------------------------------------------------
type D = Draft<DesignDoc>;

const detach = (d: D, id: string) => {
    const parent = parentOf(d as DesignDoc, id);
    const list = d.children[parent];
    const at = list ? list.indexOf(id) : -1;
    if (at >= 0) list.splice(at, 1);
    return { parent, at };
};

const attach = (d: D, id: string, parent: string, index: number) => {
    const list = (d.children[parent] ??= []);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
    if (parent === ROOT) delete d.byId[id].parentId;
    else d.byId[id].parentId = parent;
};

export function insertField(d: D, field: FormField, parent: string, index: number) {
    d.byId[field.id] = field as Draft<FormField>;
    if (field.layout?.options?.isContainer) d.children[field.id] ??= [];
    attach(d, field.id, parent, index);
}

/** Move `id` to `index` of `parent`'s children. Refused (false) into itself, its own inside or a container that does not take it. */
export function moveField(d: D, id: string, parent: string, index: number): boolean {
    const doc = d as DesignDoc;
    if (!doc.byId[id] || (parent !== ROOT && subtree(doc, id).includes(parent)) || !accepts(doc, parent, doc.byId[id].type)) return false;
    const from = detach(d, id);
    attach(d, id, parent, from.parent === parent && from.at >= 0 && from.at < index ? index - 1 : index);
    return true;
}

export function removeField(d: D, id: string) {
    const all = subtree(d as DesignDoc, id);
    detach(d, id);
    for (const x of all) {
        delete d.byId[x];
        delete d.children[x];
    }
}

/** Copy of `id` and everything inside it, right after it; the copies get new unique keys. Returns the copy's id. */
export function duplicateField(d: D, id: string): string | null {
    const doc = d as DesignDoc;
    if (!doc.byId[id]) return null;
    const taken = new Set(Object.keys(doc.byId));
    const ids = subtree(doc, id);
    const map = new Map(ids.map((x) => [x, uniqueKey(doc, `${x} copy`, taken)]));
    const copy = (x: string): FormField => {
        const src = JSON.parse(JSON.stringify(doc.byId[x])) as FormField;
        const nid = map.get(x)!;
        return {
            ...src,
            id: nid,
            label: x === id ? `${src.label} (copy)` : src.label,
            props: { ...src.props, ...(src.props?.id !== undefined && { id: nid }) },
            data: src.data && { ...src.data, defaultProps: { ...src.data.defaultProps, ...(src.data.defaultProps?.id !== undefined && { id: nid }) } }
        } as FormField;
    };
    const { parent, at } = { parent: parentOf(doc, id), at: siblingsOf(doc, id).indexOf(id) };
    const place = (x: string, into: string, index: number) => {
        insertField(d, copy(x), into, index);
        (doc.children[x] ?? []).forEach((c, i) => place(c, map.get(x)!, i));
    };
    place(id, parent, at + 1);
    return map.get(id)!;
}

/** Rename a field's key everywhere it is used (children, conditions, formulas, bindings, data sources). */
export function renameKey(doc: DesignDoc, oldKey: string, newKey: string): DesignDoc {
    const stored = toStored(doc);
    const fields = renameFieldKey(stored.fields, oldKey, newKey).map((f) =>
        f.id === newKey
            ? ({
                  ...f,
                  props: { ...f.props, ...(f.props?.id !== undefined && { id: newKey }) },
                  data: f.data && { ...f.data, defaultProps: { ...f.data.defaultProps, ...(f.data.defaultProps?.id !== undefined && { id: newKey }) } }
              } as FormField)
            : f
    );
    return fromStored({ fields }, renameInRuntime(doc.runtime, oldKey, newKey)).doc;
}

/** Set (or, with `undefined`, remove) the value at a dotted path inside a field draft, creating objects on the way. */
export function setPath(target: Record<string, any>, path: string, value: unknown) {
    const keys = path.split('.');
    let o = target;
    for (const k of keys.slice(0, -1)) {
        if (!o[k] || typeof o[k] !== 'object') o[k] = {};
        o = o[k];
    }
    const last = keys[keys.length - 1];
    if (value === undefined) delete o[last];
    else o[last] = value;
}

export const getPath = (target: unknown, path: string): unknown => path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), target);
