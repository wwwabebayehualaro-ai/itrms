/**
 * Form values: what an untouched form holds, a blank row of a repeatable section, and what is submitted (values of hidden
 * fields are dropped, inside rows too). Values are keyed by field id; a repeatable section's value is an array of row objects
 * keyed by its child field ids. This shape is what the backend stores and queries, so it never changes.
 */
import { evaluateAll, type Scope } from './conditions';
import { childrenOf, isFormArray, rowScopedIds, type EngineField } from './model';
import { bindingRoots, resolveString } from './runtime/expression';

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

/**
 * Visible = its own rules hold and every container around it (inside the same scope) is visible. A removed field (or a
 * removed container) is never visible: it is not drawn, taken or checked.
 */
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
        if (f.removed || !evaluateAll(f.visibleWhen, values, scope)) return false;
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
    // a field is judged on the values that stay: one shown only by a hidden field's value goes too
    let out = values;
    for (let pass = 0; pass <= fields.length; pass++) {
        const next = prune(null, out, out);
        if (JSON.stringify(next) === JSON.stringify(out)) return next;
        out = next;
    }
    return out;
}

/** The most rows a repeatable section takes, whatever its own maximum (a rule in a row may read every row). */
export const MAX_ROWS = 1000;

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
            if (!isFormArray(f)) out[f.id] = v;
            // a section's value is its rows: anything else is not one; past the cap, validation refuses it, and
            // nothing runs over more rows than one past it (rules may read every row from each row)
            else if (Array.isArray(v))
                out[f.id] = v.slice(0, MAX_ROWS + 1).map((row) => keep(f.id, isRecord(row) ? row : {}));
        }
        return out;
    };
    return keep(null, values);
}

/**
 * What the browser may keep of a draft's answers (task 0.20c, SEC-WB-3): only those of fields their author classified,
 * and not Sensitive. A field without a data class (a form published before classes existed) is kept on the server only,
 * as a Sensitive one is; a field inside a Sensitive container goes with it; keys the form does not have are dropped.
 */
export function withoutSensitive(fields: EngineField[], values: Record<string, unknown>): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const serverOnly = (f: EngineField): boolean => {
        if (!f.source.classification) return true;
        for (let p: EngineField | undefined = f; p; p = p.parentId ? byId.get(p.parentId) : undefined)
            if (p.classification === 'sensitive') return true;
        return false;
    };
    const keep = (current: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(current)) {
            const f = byId.get(key);
            if (!f || serverOnly(f)) continue;
            out[key] =
                isFormArray(f) && Array.isArray(v)
                    ? (v as unknown[]).map((row: unknown) => (isRecord(row) ? keep(row) : row))
                    : v;
        }
        return out;
    };
    return keep(values);
}

/**
 * The answers with those of Sensitive fields taken out (task 0.20d, SEC-PD-2): what a list, a record or an export shows
 * by default; `masked` names the fields taken out (their answers come only through the audited reveal). A field inside a
 * Sensitive container goes with it; a repeating section's rows lose their Sensitive fields' answers.
 */
export function maskSensitive(
    fields: EngineField[],
    values: Record<string, unknown>
): { values: Record<string, unknown>; masked: string[] } {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const sensitive = (f: EngineField): boolean => {
        for (let p: EngineField | undefined = f; p; p = p.parentId ? byId.get(p.parentId) : undefined)
            if (p.classification === 'sensitive') return true;
        return false;
    };
    const masked = new Set<string>();
    const keep = (current: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(current)) {
            const f = byId.get(key);
            if (f && sensitive(f)) {
                masked.add(key);
                continue;
            }
            out[key] =
                f && isFormArray(f) && Array.isArray(v)
                    ? (v as unknown[]).map((row: unknown) => (isRecord(row) ? keep(row) : row))
                    : v;
        }
        return out;
    };
    const kept = keep(values);
    return { values: kept, masked: [...masked] };
}

/** The answers of a form's Sensitive fields alone (the audited reveal's), rows of a section by their row. */
export function onlySensitive(fields: EngineField[], values: Record<string, unknown>): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const sensitive = (f: EngineField): boolean => {
        for (let p: EngineField | undefined = f; p; p = p.parentId ? byId.get(p.parentId) : undefined)
            if (p.classification === 'sensitive') return true;
        return false;
    };
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(values)) {
        const f = byId.get(key);
        if (!f) continue;
        if (sensitive(f)) out[key] = v;
        else if (isFormArray(f) && Array.isArray(v)) {
            const rows = (v as unknown[]).map((row: unknown) => (isRecord(row) ? onlySensitive(fields, row) : {}));
            if (rows.some((r) => Object.keys(r).length)) out[key] = rows;
        }
    }
    return out;
}

/** Whether some of the form's answers are kept on the server only (a Sensitive field, or one without a data class). */
export const keepsServerOnly = (fields: EngineField[]): boolean =>
    fields.some((f) => holdsValue(f) && (f.classification === 'sensitive' || !f.source.classification));

/** Roots a computed field may read wherever the form is checked: the server has no data sources, route or variables. */
const PORTABLE_ROOTS = new Set(['form', 'row', 'root', 'user']);

/**
 * A read-only computed field derived from the answers alone (its formula reads the form and its rows, never the user):
 * whoever changes the answers it reads, it is computed again the same way (a request changed through its case, task
 * 0.21e). One that reads the user would take the changer's identity; one that reads data sources is not computed here.
 */
export function answerDerived(f: EngineField): boolean {
    if (!holdsValue(f) || !f.computed?.readOnly || !f.computed.expression) return false;
    return [...bindingRoots(f.computed.expression)].every((r) => r === 'form' || r === 'row' || r === 'root');
}

/** The most passes `settledValues` makes over computed fields that read each other (more than that is a cycle). */
const MAX_SETTLE_PASSES = 10;

/**
 * What a person could not have typed is the form's, not theirs, wherever the values come from (a browser, or a direct API
 * call): a read-only computed field gets its computed value (when its expression reads only the form, its rows and the
 * user), and a disabled field its default. Rules are evaluated against each row like the other passes.
 *
 * A computed field may read another computed field, in a row or at the top level (`root.total` over the rows' line totals):
 * the pass runs in stored order against the values settled so far, and repeats until nothing changes. A loop of fields that
 * read each other never settles, so the passes are capped (the number of computed fields, at most 10, and one more).
 */
export function settledValues(
    fields: EngineField[],
    values: Record<string, unknown>,
    scope: Scope = {}
): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const portable = (f: EngineField) =>
        holdsValue(f) &&
        f.computed?.readOnly &&
        f.computed.expression &&
        [...bindingRoots(f.computed.expression)].every((r) => PORTABLE_ROOTS.has(r));

    const pass = (input: Record<string, unknown>) => {
        const top = { ...input };
        const settle = (parentId: string | null, current: Record<string, unknown>) => {
            const ctx = { ...scope, root: top };
            for (const f of scopeFields(fields, parentId)) {
                if (!holdsValue(f)) continue;
                const expression = portable(f) ? f.computed?.expression : undefined;
                if (expression) {
                    const v = resolveString(expression, { ...scope, form: current, row: current, root: top });
                    if (v === undefined) delete current[f.id];
                    else current[f.id] = v;
                } else if (!isEnabledIn(f, byId, current, ctx, parentId)) {
                    const v = initialValueOf(f, fields);
                    if (v === undefined) delete current[f.id];
                    else current[f.id] = v;
                } else if (isFormArray(f) && Array.isArray(current[f.id])) {
                    current[f.id] = (current[f.id] as Record<string, unknown>[]).map((row) =>
                        settle(f.id, { ...(row ?? {}) })
                    );
                }
            }
            return current;
        };
        return settle(null, top);
    };

    const passes = Math.min(fields.filter(portable).length, MAX_SETTLE_PASSES) + 1;
    let out = values;
    for (let i = 0; i < passes; i++) {
        const next = pass(out);
        const same = JSON.stringify(next) === JSON.stringify(out);
        out = next;
        if (same) break;
    }
    return out;
}

/**
 * What a submission stores: the form's own values (`knownValues`), with what nobody types settled (`settledValues`), without
 * those of hidden fields (`pruneHidden`).
 */
export function submittedValues(fields: EngineField[], values: Record<string, unknown>, scope: Scope = {}) {
    const known = knownValues(fields, values);
    return pruneHidden(fields, settledValues(fields, known, scope), scope);
}
