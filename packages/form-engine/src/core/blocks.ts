/**
 * Reusable blocks (task 1.13d, form-platform.md §6): a block is a form of kind `block`, versioned and published like any form.
 * A form takes a **copy** of a published version of it: a section whose `props.block` names the block, its version and the
 * prefix its copied keys carry (empty unless a key would have clashed). The copy is the form's own from then on: a published form
 * version never changes, and a form takes a block's new version only when its author updates it. UI-free: the API's impact and the
 * builder read these.
 */

/** What a block's section remembers of the block it is a copy of. */
export interface BlockRef {
    /** the block's form key */
    key: string;
    /** the block's version copied */
    version: number;
    /** put before each copied key, so two copies (or a clash with the form's own keys) stay apart; '' for none */
    prefix: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The block a stored field is the copy of, or null. */
export function blockRefOf(field: unknown): BlockRef | null {
    const block = isRecord(field) && isRecord(field.props) ? field.props.block : undefined;
    if (!isRecord(block) || typeof block.key !== 'string' || !block.key) return null;
    const version = block.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
    return { key: block.key, version, prefix: typeof block.prefix === 'string' ? block.prefix : '' };
}

/** The fields of a stored document (a bare list is the oldest format). */
function fieldsOf(document: unknown): unknown[] {
    if (Array.isArray(document)) return document;
    return isRecord(document) && Array.isArray(document.fields) ? document.fields : [];
}

/** The versions of a block a stored document holds a copy of, lowest first, once each (empty: none). */
export function blockUses(document: unknown, blockKey: string): number[] {
    const versions = new Set<number>();
    for (const f of fieldsOf(document)) {
        const ref = blockRefOf(f);
        if (ref?.key === blockKey) versions.add(ref.version);
    }
    return [...versions].sort((a, b) => a - b);
}
