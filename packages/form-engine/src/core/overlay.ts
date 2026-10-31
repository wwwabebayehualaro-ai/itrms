/**
 * Form overlays (task 0.21f, form-platform.md §4): a unit's additions to a bureau form, composed onto a version of it.
 * Pure: the API composes the form a unit's new cases are filed on, and checks an overlay when it is written; the builder
 * can preview the same. An overlay only adds fields after an anchor and narrows a choice field's options to part of the
 * bureau's: no operation can touch a bureau field otherwise, nor any field a contract locks.
 *
 * Composing never fails: an operation that no longer fits the base (its anchor gone, its key now the bureau's, an option
 * the bureau dropped) is passed over and reported, and the rest of the overlay still applies, as a configuration value
 * that does not fit is passed over (task 0.21b). An overlay whose composition makes the form unsound (a lint error the
 * base did not have) is passed over whole.
 */
import { OVERLAY_KEY, type FormOverlay, type OverlayConflictCode } from '@itrms/schemas';

import { lintDocument } from './lint';
import { readDocument, rowScopedIds } from './model';

/** One overlay to compose, as its unit published it. */
export interface OverlayLayer {
    unitId: string;
    /** the published overlay version this layer is (the composed form names it) */
    versionId: string;
    patch: FormOverlay;
}

/** An operation of an overlay passed over (when composing) or refused (when written), and why. */
export interface OverlayConflict {
    unitId: string;
    versionId: string;
    op: 'add' | 'options' | 'overlay';
    /** the anchor of an addition, the field of an options change; null for a whole overlay */
    key: string | null;
    problem: OverlayConflictCode;
}

type RawField = Record<string, unknown> & { id?: unknown; parentId?: unknown };
type RawDocument = Record<string, unknown> & { fields: RawField[] };

/** A stored id or parent id: a string, or a number from an old builder (anything else is none). */
const keyText = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
const idOf = (f: RawField) => keyText(f.id) ?? '';
const parentOf = (f: RawField) => keyText(f.parentId);

function rawDocument(base: unknown): RawDocument {
    const doc = Array.isArray(base) ? { fields: base } : base && typeof base === 'object' ? base : {};
    const fields = Array.isArray((doc as { fields?: unknown }).fields) ? (doc as { fields: unknown[] }).fields : [];
    return {
        ...(structuredClone(doc) as Record<string, unknown>),
        fields: structuredClone(fields).filter((f): f is RawField => !!f && typeof f === 'object')
    };
}

/** A choice field's stored options (`data.dataSource.staticData`, else `props.options`), and where they are. */
function optionsOf(f: RawField): { list: unknown[]; at: 'staticData' | 'props' } | null {
    const data = f.data as { dataSource?: { staticData?: unknown } } | null | undefined;
    if (Array.isArray(data?.dataSource?.staticData))
        return { list: data.dataSource.staticData as unknown[], at: 'staticData' };
    const props = f.props as { options?: unknown } | null | undefined;
    if (Array.isArray(props?.options)) return { list: props.options as unknown[], at: 'props' };
    return null;
}

const optionValue = (o: unknown): unknown => (o && typeof o === 'object' ? (o as { value?: unknown }).value : o);

const isBound = (f: RawField) => {
    const data = f.data as { optionsBinding?: unknown } | null | undefined;
    return !!data?.optionsBinding;
};

/** What an added field may not carry (G8: no outside calls; indexing local fields is not offered yet). */
function forbiddenProperty(f: RawField): boolean {
    const data = f.data as { optionsBinding?: unknown; rowsBinding?: unknown } | null | undefined;
    const behavior = f.behavior as { actions?: unknown; validation?: { remote?: unknown } } | null | undefined;
    return (
        f.filterable === true ||
        !!data?.optionsBinding ||
        !!data?.rowsBinding ||
        (Array.isArray(behavior?.actions) && behavior.actions.length > 0) ||
        !!behavior?.validation?.remote
    );
}

/**
 * The problems of an overlay as it is written onto a base (the first refuses it): every added key reserved (`x_…`),
 * new and unique; a nested added field inside its own group; no forbidden property; every anchor on the form, outside
 * a repeating section; every options change on an unlocked, unbound choice field and within its options.
 */
export function checkOverlay(
    base: unknown,
    patch: FormOverlay,
    opts: { locks?: ReadonlySet<string>; takenKeys?: ReadonlySet<string> } = {}
): { op: 'add' | 'options'; key: string; problem: OverlayConflictCode }[] {
    const doc = rawDocument(base);
    const byId = new Map(doc.fields.map((f) => [idOf(f), f]));
    const inRows = rowScopedIds(readDocument(base).fields);
    const problems: { op: 'add' | 'options'; key: string; problem: OverlayConflictCode }[] = [];
    const added = new Set<string>();
    for (const group of patch.add) {
        const own = new Set(group.fields.map((f) => String(f.id)));
        if (!byId.has(group.after)) problems.push({ op: 'add', key: group.after, problem: 'anchor_missing' });
        else if (inRows.has(group.after)) problems.push({ op: 'add', key: group.after, problem: 'anchor_in_rows' });
        for (const field of group.fields as RawField[]) {
            const key = idOf(field);
            if (!OVERLAY_KEY.test(key)) problems.push({ op: 'add', key, problem: 'key_reserved' });
            else if (byId.has(key) || added.has(key) || opts.takenKeys?.has(key))
                problems.push({ op: 'add', key, problem: 'key_taken' });
            added.add(key);
            const parent = parentOf(field);
            if (parent !== null && !own.has(parent)) problems.push({ op: 'add', key, problem: 'nested_outside' });
            if (forbiddenProperty(field)) problems.push({ op: 'add', key, problem: 'not_allowed_property' });
        }
    }
    for (const change of patch.options) problems.push(...optionProblems(byId, change, opts.locks));
    return problems;
}

function optionProblems(
    byId: ReadonlyMap<string, RawField>,
    change: FormOverlay['options'][number],
    locks: ReadonlySet<string> | undefined
): { op: 'options'; key: string; problem: OverlayConflictCode }[] {
    const field = byId.get(change.key);
    const fail = (problem: OverlayConflictCode) => [{ op: 'options' as const, key: change.key, problem }];
    if (!field) return fail('field_missing');
    if (locks?.has(change.key)) return fail('locked');
    const options = optionsOf(field);
    if (!options || isBound(field)) return fail('not_choice');
    const allowed = new Set(options.list.map((o) => JSON.stringify(optionValue(o))));
    if (change.values.some((v) => !allowed.has(JSON.stringify(v)))) return fail('option_not_allowed');
    return [];
}

/** The lint errors of a document, by rule and field (a composition must add none the base did not have). */
const errorsOf = (doc: unknown) =>
    new Set(
        lintDocument(doc)
            .filter((p) => p.severity === 'error')
            .map((p) => `${p.rule}|${p.fieldId ?? ''}`)
    );

/**
 * The base with the overlays composed onto it, root side first (a zone's, then a woreda's), and what was passed over.
 * Each added field is marked `metadata.overlay = { unitId }` (a screen can show it as local).
 */
export function applyOverlays(
    base: unknown,
    layers: readonly OverlayLayer[],
    opts: { locks?: ReadonlySet<string> } = {}
): { document: unknown; conflicts: OverlayConflict[] } {
    let doc = rawDocument(base);
    const conflicts: OverlayConflict[] = [];
    const baseErrors = layers.length ? errorsOf(doc) : new Set<string>();
    for (const layer of layers) {
        const next = rawDocument(doc);
        const found: OverlayConflict[] = [];
        const conflict = (op: OverlayConflict['op'], key: string | null, problem: OverlayConflictCode) =>
            found.push({ unitId: layer.unitId, versionId: layer.versionId, op, key, problem });
        const inRows = rowScopedIds(readDocument(next).fields);
        for (const group of layer.patch.add) {
            const ids = new Set(next.fields.map(idOf));
            const at = next.fields.findIndex((f) => idOf(f) === group.after);
            if (at < 0) {
                conflict('add', group.after, 'anchor_missing');
                continue;
            }
            if (inRows.has(group.after)) {
                conflict('add', group.after, 'anchor_in_rows');
                continue;
            }
            if ((group.fields as RawField[]).some((f) => ids.has(idOf(f)) || !OVERLAY_KEY.test(idOf(f)))) {
                conflict('add', group.after, 'key_taken');
                continue;
            }
            const anchorParent = parentOf(next.fields[at] as RawField);
            const own = new Set((group.fields as RawField[]).map(idOf));
            const inserted = (structuredClone(group.fields) as RawField[]).map((f) => {
                const parent = parentOf(f);
                const out: RawField = {
                    ...f,
                    metadata: { ...(f.metadata ?? {}), overlay: { unitId: layer.unitId } }
                };
                if (parent === null || !own.has(parent)) {
                    if (anchorParent === null) delete out.parentId;
                    else out.parentId = anchorParent;
                }
                return out;
            });
            next.fields.splice(at + 1, 0, ...inserted);
        }
        const byId = new Map(next.fields.map((f) => [idOf(f), f]));
        for (const change of layer.patch.options) {
            const problem = optionProblems(byId, change, opts.locks)[0];
            if (problem) {
                conflict('options', change.key, problem.problem);
                continue;
            }
            const field = byId.get(change.key) as RawField;
            const options = optionsOf(field);
            if (!options) continue;
            const keep = new Set(change.values.map((v) => JSON.stringify(v)));
            const narrowed = options.list.filter((o) => keep.has(JSON.stringify(optionValue(o))));
            if (options.at === 'staticData') {
                const data = field.data as { dataSource: Record<string, unknown> };
                data.dataSource = { ...data.dataSource, staticData: narrowed };
            } else field.props = { ...(field.props as Record<string, unknown>), options: narrowed };
        }
        // a layer that makes the form unsound is passed over whole
        const errors = errorsOf(next);
        if ([...errors].some((e) => !baseErrors.has(e))) {
            conflicts.push({
                unitId: layer.unitId,
                versionId: layer.versionId,
                op: 'overlay',
                key: null,
                problem: 'invalid'
            });
            continue;
        }
        conflicts.push(...found);
        doc = next;
    }
    return { document: doc, conflicts };
}
