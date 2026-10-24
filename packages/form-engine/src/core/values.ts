/**
 * Form values: what an untouched form holds, a blank row of a repeatable section, and what is submitted (values of hidden
 * fields are dropped, inside rows too). Values are keyed by field id; a repeatable section's value is an array of row objects
 * keyed by its child field ids. This shape is what the backend stores and queries, so it never changes.
 */
import { evaluateAll, type Scope } from './conditions';
import { childrenOf, isFormArray, rowScopedIds, type EngineField } from './model';

/** What an untouched field of each type holds. */
const TYPE_DEFAULTS: Record<string, unknown> = {
    Checkbox: false,
    InputSwitch: false,
    MultiSelect: [],
    CheckboxGroup: [],
    FileUpload: [],
    Chips: [],
    Slider: 0,
    Rating: 0
};
const LIST_TYPES = new Set(['MultiSelect', 'CheckboxGroup', 'Chips', 'FileUpload']);

/** Fields that hold a value of their own (inputs and repeatable sections). */
export const holdsValue = (f: EngineField) => f.category === 'Input' || isFormArray(f);

/** True for fields whose value is a list of selections. */
export const isListField = (f: EngineField) =>
    LIST_TYPES.has(f.type) || (f.type === 'Dropdown' && Boolean(f.props.multiple));

/** Value of one field with nothing entered yet. A repeatable section starts with its minimum number of blank rows. */
export function initialValueOf(field: EngineField, all: EngineField[]): unknown {
    if (isFormArray(field)) return Array.from({ length: field.rules.minItems }, () => emptyRow(field, all));
    const v = field.props.value;
    if (isListField(field)) return Array.isArray(v) ? structuredClone(v) : []; // a palette default of "" must not turn a list into a string
    // a number box starts empty (the palette's default 0 would satisfy "required" without anyone typing anything)
    if (field.type === 'InputNumber' && (v === 0 || v === '' || v === null)) return undefined;
    if (v !== undefined) return v && typeof v === 'object' ? structuredClone(v) : v;
    return field.type in TYPE_DEFAULTS ? structuredClone(TYPE_DEFAULTS[field.type]) : undefined;
}

/** A blank row of a repeatable section: every value-holding child gets its default. */
export function emptyRow(section: EngineField, all: EngineField[]): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const c of childrenOf(all, section.id)) {
        if (!holdsValue(c)) continue;
        const v = initialValueOf(c, all);
        if (v !== undefined) row[c.id] = v;
    }
    return row;
}

/** Initial values of a form: static defaults, then `overrides` (a saved request, API-loaded data). */
export function initialValues(fields: EngineField[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const scoped = rowScopedIds(fields);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
        if (scoped.has(f.id) || !holdsValue(f)) continue;
        const v = initialValueOf(f, fields);
        if (v !== undefined) out[f.id] = v;
    }
    return { ...out, ...overrides };
}

/**
 * The fields whose values sit in one object of values: the top level of the form, or one row of a section. Containers
 * (panels, cards) are transparent: their children's values sit beside theirs.
 */
export function scopeFields(fields: EngineField[], parentId: string | null): EngineField[] {
    const out: EngineField[] = [];
    const walk = (pid: string | null) => {
        for (const f of childrenOf(fields, pid)) {
            out.push(f);
            if (!isFormArray(f)) walk(f.id);
        }
    };
    walk(parentId);
    return out;
}

/** Visible = its own rules hold and every container around it (inside the same scope) is visible. */
export function isVisibleIn(
    field: EngineField,
    byId: Map<string, EngineField>,
    values: Record<string, unknown>,
    scope: Scope,
    stopAt: string | null
): boolean {
    for (
        let f: EngineField | undefined = field;
        f && f.id !== stopAt;
        f = f.parentId ? byId.get(f.parentId) : undefined
    ) {
        if (!evaluateAll(f.visibleWhen, values, scope)) return false;
    }
    return true;
}

export function isEnabledIn(
    field: EngineField,
    byId: Map<string, EngineField>,
    values: Record<string, unknown>,
    scope: Scope,
    stopAt: string | null
): boolean {
    for (
        let f: EngineField | undefined = field;
        f && f.id !== stopAt;
        f = f.parentId ? byId.get(f.parentId) : undefined
    ) {
        if (!evaluateAll(f.enabledWhen, values, scope)) return false;
    }
    return true;
}

/** The values to submit: values of hidden fields are removed, inside each row too (rules evaluated against that row). */
export function pruneHidden(
    fields: EngineField[],
    values: Record<string, unknown>,
    scope: Scope = {}
): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const prune = (parentId: string | null, current: Record<string, unknown>, root: Record<string, unknown>) => {
        const out = { ...current };
        const ctx = { ...scope, root };
        for (const f of scopeFields(fields, parentId)) {
            if (!(f.id in out)) continue;
            if (!isVisibleIn(f, byId, current, ctx, parentId)) delete out[f.id];
            else if (isFormArray(f) && Array.isArray(out[f.id]))
                out[f.id] = (out[f.id] as Record<string, unknown>[]).map((row) => prune(f.id, row ?? {}, root));
        }
        return out;
    };
    return prune(null, values, values);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Only the values of fields that hold one, at the level where each sits (inside rows too); every other key is dropped. Runs
 * before the rules: a key that is no field of the form could otherwise stand in for what a condition reads (`user.role`).
 */
export function knownValues(fields: EngineField[], values: Record<string, unknown>): Record<string, unknown> {
    const keep = (parentId: string | null, current: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const f of scopeFields(fields, parentId)) {
            if (!holdsValue(f) || !Object.hasOwn(current, f.id)) continue;
            const v = current[f.id];
            out[f.id] = isFormArray(f) && Array.isArray(v) ? v.map((row) => keep(f.id, isRecord(row) ? row : {})) : v;
        }
        return out;
    };
    return keep(null, values);
}

/** What a submission stores: the form's own values (`knownValues`) without those of hidden fields (`pruneHidden`). */
export const submittedValues = (fields: EngineField[], values: Record<string, unknown>, scope: Scope = {}) =>
    pruneHidden(fields, knownValues(fields, values), scope);
