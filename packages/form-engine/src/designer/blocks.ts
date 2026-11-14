/**
 * A block in the builder (task 1.13d): its published version copied into the form as a section that remembers the block, its
 * version and the prefix its keys carry (empty unless a key would clash with the form's), and that copy updated to a newer version
 * when the author asks. The copy is the form's own: its keys follow the form's key rules, its references to its own fields are
 * renamed with it.
 */
import type { FormField, FormText } from '@itrms/schemas';

import { blockRefOf, type BlockRef } from '../core/blocks';
import { keyFromLabel, renameFieldKey } from './fieldKeys';

/** A block's published version, as the builder copies it. */
export interface BlockSource {
    key: string;
    version: number;
    name: FormText;
    document: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The block's own fields (a removed key, and what is inside it, never comes along into another form). */
export function blockFieldsOf(document: unknown): FormField[] {
    const list = Array.isArray(document)
        ? document
        : isRecord(document) && Array.isArray(document.fields)
          ? document.fields
          : [];
    const fields = (list as FormField[]).filter((f) => isRecord(f) && typeof f.id === 'string');
    const gone = new Set(fields.filter((f) => f.removed).map((f) => f.id));
    // a field inside a removed one goes with it (parents come before their children in a stored document)
    for (const f of fields) if (f.parentId && gone.has(f.parentId)) gone.add(f.id);
    return fields.filter((f) => !gone.has(f.id));
}

/** No prefix when none of the block's keys is taken; else the block's key and a number (`applicant2_`). */
export function blockPrefix(source: BlockSource, taken: ReadonlySet<string>): string {
    const keys = blockFieldsOf(source.document).map((f) => f.id);
    const clashes = (prefix: string) => keys.some((k) => taken.has(prefix + k));
    if (!clashes('')) return '';
    const base = keyFromLabel(source.key) || 'block';
    for (let n = 2; ; n++) if (!clashes(`${base}${n}_`)) return `${base}${n}_`;
}

/**
 * The block's fields with their keys prefixed (and every reference to them in the copy renamed too), the top ones placed in
 * `containerId`.
 */
export function blockCopy(source: BlockSource, prefix: string, containerId: string): FormField[] {
    const own = blockFieldsOf(source.document);
    let fields = own.map((f) => structuredClone(f));
    if (prefix) for (const f of own) fields = renameFieldKey(fields, f.id, `${prefix}${f.id}`);
    return fields.map((f) => (f.parentId ? f : { ...f, parentId: containerId }));
}

/** What a block's section holds in `props.block`. */
export const blockRef = (source: BlockSource, prefix: string): BlockRef => ({
    key: source.key,
    version: source.version,
    prefix
});

/** The block a section of the form is a copy of, or null. */
export const blockOfField = (field: FormField | undefined): BlockRef | null => (field ? blockRefOf(field) : null);
