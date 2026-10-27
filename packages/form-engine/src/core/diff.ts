/**
 * What changed between two versions of a stored form (task 0.18a), by field key. The publish review and the version history
 * show it; it reads the documents only, so the browser and the API give the same answer.
 */
import { REQUIRED_TEXT_LANGUAGES, fieldTexts, ownText, textPropsOf } from '@itrms/schemas';

import { valueKindOf } from './kinds';
import { readDocument, type EngineField } from './model';

export type DiffArea =
    | 'label'
    | 'texts'
    | 'type'
    | 'kind'
    | 'parent'
    | 'order'
    | 'options'
    | 'required'
    | 'rules'
    | 'visibility'
    | 'enabled'
    | 'computed'
    | 'roles'
    | 'filterable'
    | 'settings';

export interface DiffChange {
    area: DiffArea;
    /** The languages whose text changed (label, texts, option labels). */
    languages?: string[];
    /** Which text (its path), setting or option list the change is about. */
    key?: string;
    before?: unknown;
    after?: unknown;
}

export interface DiffField {
    key: string;
    label: string;
    type: string;
}

export interface FormDiff {
    added: DiffField[];
    /** Deleted from the form, or newly flagged `removed`. */
    removed: DiffField[];
    /** Unflagged again. */
    restored: DiffField[];
    changed: { key: string; label: string; changes: DiffChange[] }[];
    /** What changed beside the fields. */
    form: { area: 'dataSources' | 'testCases' | 'textLanguage' }[];
}

/** JSON with sorted keys, so two equal values give the same text. */
function canon(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object')
        return `{${Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`)
            .join(',')}}`;
    return JSON.stringify(v) ?? 'undefined';
}

const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const brief = (f: EngineField): DiffField => ({ key: f.id, label: f.label, type: f.type });

function optionValues(raw: unknown, acc: unknown[] = []): unknown[] {
    if (!Array.isArray(raw)) return acc;
    for (const o of raw as unknown[]) {
        if (isRecord(o)) {
            if (o.value !== undefined) acc.push(o.value);
            optionValues(o.items, acc);
        } else if (typeof o === 'string' || typeof o === 'number') acc.push(o);
    }
    return acc;
}

const optionsOf = (f: EngineField) => f.source.data?.dataSource?.staticData ?? f.props.options;

/** The languages (of those either text names, and the required ones) in which two texts differ. */
function languagesChanged(a: unknown, b: unknown, plainA: string, plainB: string): string[] {
    const tags = new Set<string>([...REQUIRED_TEXT_LANGUAGES, plainA, plainB]);
    for (const text of [a, b]) if (isRecord(text)) Object.keys(text).forEach((t) => tags.add(t));
    return [...tags].filter((l) => ownText(a, l, plainA) !== ownText(b, l, plainB)).sort();
}

/** The validation rules without what is a text (those are in `texts`) or has an area of its own. */
function rulesOf(f: EngineField) {
    const v = f.source.behavior?.validation;
    const rules = Object.fromEntries(Object.entries(v?.rules ?? {}).filter(([k]) => k !== 'patternMessage'));
    return {
        supported: v?.supported,
        types: (v?.types ?? []).filter((t) => t !== 'required'),
        rules,
        remote: v?.remote?.dataSourceId,
        validWhen: (v?.validWhen ?? []).map((r) => r.expression)
    };
}

/** The settings of a field by name: its props without texts, options and Required, plus the bindings and actions. */
function settingsOf(f: EngineField): Record<string, unknown> {
    const skip = new Set([...textPropsOf(f.type), 'options', 'required']);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.props)) {
        if (skip.has(k)) continue;
        out[k] =
            k === 'columns' && Array.isArray(v)
                ? v.map((c: unknown) => (isRecord(c) ? { ...c, header: undefined } : c))
                : v;
    }
    const strip = (binding: unknown) => (isRecord(binding) ? { ...binding, emptyMessage: undefined } : binding);
    out.optionsBinding = strip(f.source.data?.optionsBinding);
    out.rowsBinding = strip(f.source.data?.rowsBinding);
    out.actions = f.source.behavior?.actions;
    out.category = f.category;
    out.isContainer = f.isContainer;
    return out;
}

function changesOf(
    a: EngineField,
    b: EngineField,
    plainA: string,
    plainB: string,
    orderA: Map<string, number>,
    orderB: Map<string, number>
): DiffChange[] {
    const out: DiffChange[] = [];
    if (a.type !== b.type) out.push({ area: 'type', before: a.type, after: b.type });
    const kindA = valueKindOf(a);
    const kindB = valueKindOf(b);
    if (kindA !== kindB) out.push({ area: 'kind', before: kindA, after: kindB });
    if (a.parentId !== b.parentId) out.push({ area: 'parent', before: a.parentId, after: b.parentId });
    const ia = orderA.get(a.id);
    const ib = orderB.get(b.id);
    if (ia !== ib) out.push({ area: 'order', before: ia, after: ib });

    const textsA = new Map(fieldTexts(a.source).map((t) => [t.path, t]));
    const textsB = new Map(fieldTexts(b.source).map((t) => [t.path, t]));
    for (const path of new Set([...textsA.keys(), ...textsB.keys()])) {
        const ta = textsA.get(path);
        const tb = textsB.get(path);
        const languages = languagesChanged(ta?.value, tb?.value, plainA, plainB);
        if (languages.length === 0) continue;
        const kind = (ta ?? tb)?.kind;
        if (kind === 'label') out.push({ area: 'label', languages });
        else if (kind === 'option') out.push({ area: 'options', languages, key: path });
        else out.push({ area: 'texts', languages, key: path });
    }

    const valuesA = new Map(optionValues(optionsOf(a)).map((v) => [canon(v), v]));
    const valuesB = new Map(optionValues(optionsOf(b)).map((v) => [canon(v), v]));
    const gone = [...valuesA].filter(([k]) => !valuesB.has(k)).map(([, v]) => v);
    const came = [...valuesB].filter(([k]) => !valuesA.has(k)).map(([, v]) => v);
    if (gone.length || came.length)
        out.push({
            area: 'options',
            before: gone.length ? gone : undefined,
            after: came.length ? came : undefined
        });

    if (a.rules.required !== b.rules.required)
        out.push({ area: 'required', before: a.rules.required, after: b.rules.required });
    if (a.rules.requiredWhen !== b.rules.requiredWhen)
        out.push({ area: 'required', key: 'requiredWhen', before: a.rules.requiredWhen, after: b.rules.requiredWhen });
    if (!same(rulesOf(a), rulesOf(b))) out.push({ area: 'rules', before: rulesOf(a), after: rulesOf(b) });
    if (!same(a.visibleWhen, b.visibleWhen))
        out.push({ area: 'visibility', before: a.visibleWhen, after: b.visibleWhen });
    if (!same(a.enabledWhen, b.enabledWhen)) out.push({ area: 'enabled', before: a.enabledWhen, after: b.enabledWhen });
    if (!same(a.computed, b.computed)) out.push({ area: 'computed', before: a.computed, after: b.computed });
    if (!same([...(a.visibleToRoles ?? [])].sort(), [...(b.visibleToRoles ?? [])].sort()))
        out.push({ area: 'roles', before: a.visibleToRoles ?? [], after: b.visibleToRoles ?? [] });
    if (a.filterable !== b.filterable) out.push({ area: 'filterable', before: a.filterable, after: b.filterable });

    const settingsA = settingsOf(a);
    const settingsB = settingsOf(b);
    for (const key of [...new Set([...Object.keys(settingsA), ...Object.keys(settingsB)])].sort())
        if (!same(settingsA[key], settingsB[key]))
            out.push({ area: 'settings', key, before: settingsA[key], after: settingsB[key] });
    return out;
}

/** Position among the siblings both versions have (so an added field does not move the others). */
function orderAmong(fields: EngineField[], shared: Set<string>): Map<string, number> {
    const next = new Map<string | null, number>();
    const out = new Map<string, number>();
    for (const f of fields) {
        if (!shared.has(f.id)) continue;
        const at = next.get(f.parentId) ?? 0;
        out.set(f.id, at);
        next.set(f.parentId, at + 1);
    }
    return out;
}

/**
 * The fields out of the form: flagged removed, or inside a container that is (people no longer see them, their values are
 * no longer kept), as lint's `gone` reads them.
 */
function removedIn(fields: readonly EngineField[]): Set<string> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out = new Set<string>();
    for (const f of fields) {
        const seen = new Set<string>();
        for (let up: EngineField | undefined = f; up && !seen.has(up.id); up = byId.get(up.parentId ?? '')) {
            seen.add(up.id);
            if (up.removed) {
                out.add(f.id);
                break;
            }
        }
    }
    return out;
}

/** What changed from the document `a` to the document `b`. */
export function diffDocuments(a: unknown, b: unknown): FormDiff {
    const docA = readDocument(a);
    const docB = readDocument(b);
    const byA = new Map(docA.fields.map((f) => [f.id, f]));
    const byB = new Map(docB.fields.map((f) => [f.id, f]));
    const goneA = removedIn(docA.fields);
    const goneB = removedIn(docB.fields);
    const diff: FormDiff = { added: [], removed: [], restored: [], changed: [], form: [] };

    for (const f of docB.fields) if (!byA.has(f.id)) diff.added.push(brief(f));
    for (const f of docA.fields) {
        const now = byB.get(f.id);
        if (!now) {
            if (!goneA.has(f.id)) diff.removed.push(brief(f));
        } else if (!goneA.has(f.id) && goneB.has(f.id)) diff.removed.push(brief(now));
        else if (goneA.has(f.id) && !goneB.has(f.id)) diff.restored.push(brief(now));
    }

    const shared = new Set(docA.fields.filter((f) => byB.has(f.id)).map((f) => f.id));
    const orderA = orderAmong(docA.fields, shared);
    const orderB = orderAmong(docB.fields, shared);
    for (const f of docA.fields) {
        const now = byB.get(f.id);
        if (!now || goneA.has(f.id) || goneB.has(f.id)) continue;
        const changes = changesOf(f, now, docA.textLanguage, docB.textLanguage, orderA, orderB);
        if (changes.length) diff.changed.push({ key: f.id, label: now.label, changes });
    }

    if (!same(docA.runtime?.dataSources ?? [], docB.runtime?.dataSources ?? []))
        diff.form.push({ area: 'dataSources' });
    const casesOf = (raw: unknown) => (isRecord(raw) ? (raw.testCases ?? []) : []);
    if (!same(casesOf(a), casesOf(b))) diff.form.push({ area: 'testCases' });
    if (docA.textLanguage !== docB.textLanguage) diff.form.push({ area: 'textLanguage' });
    return diff;
}
