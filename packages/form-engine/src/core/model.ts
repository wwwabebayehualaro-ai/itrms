/**
 * The form document as the engine works with it. UI-free: no React, no PrimeReact, no Formik.
 *
 * What is stored (`form_config`) stays what the builder has always written: a flat list of fields linked by `parentId`, plus
 * an optional `runtime` block. The backend reads that list too (`submission_fields.py`), so the stored shape is a contract.
 * `readDocument` turns any stored version into `EngineField`s: one resolved view per field with the settings the engine uses,
 * so renderers and validation never dig through `props` / `data.defaultProps` / `behavior` themselves.
 *
 * Settings are read with a fixed precedence: an explicit `props` value wins over the palette's `data.defaultProps`.
 * PrimeReact-only props that older templates carry (`unstyled`, `pt`, `tooltipOptions`, ...) are kept in `props` but no
 * engine renderer reads them.
 */
import {
    formDocumentSchema,
    formTextIn,
    storedFieldSchema,
    type Action,
    type FieldOptionsBinding,
    type FieldRowsBinding,
    type FormField,
    type StoredField,
    type TemplateRuntimeConfig,
    type VisibilityCondition
} from '@itrms/schemas';

import { evalCondition } from './runtime/formula';
import { str } from './runtime/path';

export interface FieldOption {
    label: string;
    value: unknown;
    disabled?: boolean;
    items?: FieldOption[];
}

/** Rules the engine enforces. Only what the author set is present. */
export interface FieldRules {
    required: boolean;
    /** From the palette's validation types (they apply to an empty string too, as they always did). */
    typeEmail?: boolean;
    typeMinLength?: number;
    typeMaxLength?: number;
    /** From the editor's Rules tab (an empty value is never "too short"). */
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    patternMessage?: string;
    min?: number;
    max?: number;
    minDate?: unknown;
    maxDate?: unknown;
    maxFileSize?: number;
    accept?: string;
    minItems: number;
    maxItems: number;
    /** A formula (no `{{= }}`): the field is also required while it holds. Uses the `required` message. */
    requiredWhen?: string;
    /** Formulas that must all hold for a filled value; the first one that fails gives its message. */
    validWhen: { expression: string; message?: string }[];
}

export interface EngineField {
    id: string;
    type: string;
    category: string;
    label: string;
    parentId: string | null;
    /** Settings, resolved: `props` over `data.defaultProps`. */
    props: Record<string, unknown>;
    description?: string;
    helpText?: string;
    isContainer: boolean;
    /** False when the palette entry opted out of validation (`behavior.validation.supported === false` or no validation block). */
    validated: boolean;
    rules: FieldRules;
    /** Custom messages keyed by rule (`required`, `email`, `minItems`, `fileSize`, ...). */
    messages: Record<string, string>;
    visibleWhen: VisibilityCondition[];
    enabledWhen: VisibilityCondition[];
    computed?: { expression: string; readOnly?: boolean };
    /** Checked by a data source: valid only once its lookup with the field's value succeeded (e.g. an account number). */
    remote?: { dataSourceId: string; message?: string };
    /** Static options (API-bound options come from `optionsBinding` at run time). */
    options: FieldOption[];
    optionsBinding?: FieldOptionsBinding;
    rowsBinding?: FieldRowsBinding;
    actions: Record<string, Action[]>;
    visibleToRoles?: string[];
    /** indexed for the data viewer (ADR-0035) */
    filterable: boolean;
    /** The stored field, for extensions and the builder (never mutated by the engine). */
    source: FormField;
}

export interface EngineDocument {
    /** Version the document was stored with (1 = original builder format). */
    storedVersion: number;
    fields: EngineField[];
    runtime?: TemplateRuntimeConfig;
    /** Stored fields that could not be read (kept out of rendering, reported by the builder). */
    invalid: Array<{ index: number; message: string }>;
}

const num = (v: unknown): number | undefined =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);

/** Options as the engine draws them: labels in one language (forms/text.ts), nested ones too. */
function optionsIn(raw: unknown[], language: string): FieldOption[] {
    return raw
        .map((o): FieldOption | null => {
            if (o && typeof o === 'object') {
                const r = o as Record<string, unknown>;
                return {
                    label: formTextIn(r.label, language) ?? str(r.value ?? ''),
                    value: r.value,
                    disabled: r.disabled === true || undefined,
                    items: Array.isArray(r.items) ? optionsIn(r.items as unknown[], language) : undefined
                };
            }
            return typeof o === 'string' || typeof o === 'number' ? { label: String(o), value: o } : null;
        })
        .filter((o): o is FieldOption => !!o && (o.label !== '' || (o.value !== '' && o.value !== undefined)));
}

function staticOptions(f: StoredField, props: Record<string, unknown>, language: string): FieldOption[] {
    const raw = f.data?.dataSource?.staticData ?? props.options ?? [];
    return Array.isArray(raw) ? optionsIn(raw, language) : [];
}

/** A text the engine draws, in one language ('' when it has none). */
const textOf = (text: unknown, language: string) => formTextIn(text, language) ?? '';

/** The messages of a field's rules, in one language (a message with no text in any language is left out). */
function messagesIn(raw: Record<string, unknown> | null | undefined, language: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [rule, text] of Object.entries(raw ?? {})) {
        const value = formTextIn(text, language);
        if (value) out[rule] = value;
    }
    return out;
}

/** Texts are read in Amharic when no language is given (the installation's default). */
export const DEFAULT_TEXT_LANGUAGE = 'am';

/**
 * One stored field → the engine's view of it, its texts in `language` (forms/text.ts: the language, then Amharic, then
 * English, then any). `props` carries the resolved help text and placeholder; `source` stays the stored field.
 */
export function toEngineField(stored: StoredField, language: string = DEFAULT_TEXT_LANGUAGE): EngineField {
    const defaults = stored.data?.defaultProps ?? {};
    const props: Record<string, unknown> = { ...defaults, ...(stored.props ?? {}) };
    for (const key of ['helpText', 'placeholder'] as const)
        if (props[key] !== undefined && props[key] !== null && typeof props[key] !== 'string')
            props[key] = formTextIn(props[key], language);
    const v = stored.behavior?.validation;
    const types = v?.types ?? [];
    const rules = v?.rules ?? {};
    // "Required" is the field's Required property; templates that never had it fall back to the palette's rule list
    const required = props.required === undefined ? types.includes('required') : Boolean(props.required);
    const minItems = num(props.minItems);
    const maxItems = num(props.maxItems);

    return {
        id: stored.id,
        type: stored.type,
        category: stored.category ?? 'Input',
        label: textOf(stored.label, language),
        parentId:
            stored.parentId === undefined || stored.parentId === null || stored.parentId === ''
                ? null
                : String(stored.parentId),
        props,
        description: stored.metadata?.description,
        helpText: typeof props.helpText === 'string' ? props.helpText : undefined,
        isContainer: Boolean(stored.layout?.options?.isContainer),
        validated: Boolean(v?.supported),
        rules: {
            required,
            typeEmail: types.includes('email') || undefined,
            typeMinLength: types.includes('minLength') ? (num(props.minLength) ?? 0) : undefined,
            typeMaxLength: types.includes('maxLength') ? (num(props.maxLength) ?? Infinity) : undefined,
            minLength: num(rules.minLength),
            maxLength: num(rules.maxLength),
            pattern:
                typeof rules.pattern === 'string' && rules.pattern.length > 0 && rules.pattern.length <= 200
                    ? rules.pattern
                    : undefined,
            patternMessage: formTextIn(rules.patternMessage, language) || undefined,
            min: num(rules.min),
            max: num(rules.max),
            minDate: props.minDate || undefined,
            maxDate: props.maxDate || undefined,
            maxFileSize: num(props.maxFileSize),
            accept: typeof props.accept === 'string' && props.accept ? props.accept : undefined,
            minItems: minItems !== undefined ? Math.max(0, minItems) : 0,
            maxItems: maxItems !== undefined && maxItems > 0 ? maxItems : Infinity,
            requiredWhen: v?.requiredWhen?.expression || undefined,
            validWhen: (v?.validWhen ?? [])
                .filter((rule) => rule.expression)
                .map((rule) => ({
                    expression: rule.expression,
                    message: formTextIn(rule.message, language) || undefined
                }))
        },
        messages: messagesIn(v?.errorMessages, language),
        visibleWhen: stored.behavior?.visibilityConditions ?? [],
        enabledWhen: stored.behavior?.enabledConditions ?? [],
        computed: stored.data?.computed?.expression
            ? { expression: stored.data.computed.expression, readOnly: stored.data.computed.readOnly }
            : undefined,
        remote: v?.remote?.dataSourceId
            ? { dataSourceId: v.remote.dataSourceId, message: formTextIn(v.remote.message, language) || undefined }
            : undefined,
        options: staticOptions(stored, props, language),
        optionsBinding: stored.data?.optionsBinding ?? undefined,
        rowsBinding: stored.data?.rowsBinding ?? undefined,
        actions: (stored.behavior?.actions ?? {}) as Record<string, Action[]>,
        visibleToRoles: stored.visibleToRoles ?? undefined,
        filterable: stored.filterable === true,
        source: stored as unknown as FormField
    };
}

const runtimeOf = (raw: unknown): TemplateRuntimeConfig | undefined => {
    const rt = raw as TemplateRuntimeConfig | undefined;
    return rt && typeof rt === 'object' && Array.isArray(rt.dataSources) ? rt : undefined;
};

/**
 * Read a stored `form_config` of any version: a bare field list (the oldest templates), `{ fields, runtime }` (version 1) or a
 * versioned document. Never throws: fields that cannot be read are reported in `invalid` and left out.
 */
export function readDocument(raw: unknown, opts: { language?: string } = {}): EngineDocument {
    const language = opts.language ?? DEFAULT_TEXT_LANGUAGE;
    const doc = Array.isArray(raw) ? { fields: raw } : raw && typeof raw === 'object' ? raw : {};
    const parsed = formDocumentSchema.safeParse(doc);
    const base = parsed.success
        ? parsed.data
        : { fields: [] as unknown[], schemaVersion: undefined, runtime: undefined };
    const fields: EngineField[] = [];
    const invalid: EngineDocument['invalid'] = [];
    const seen = new Set<string>();
    base.fields.forEach((f, index) => {
        const r = storedFieldSchema.safeParse(f);
        if (!r.success) return invalid.push({ index, message: r.error.issues[0]?.message ?? 'invalid field' });
        if (seen.has(r.data.id)) return invalid.push({ index, message: `duplicate field id "${r.data.id}"` });
        seen.add(r.data.id);
        fields.push(toEngineField(r.data, language));
    });
    return { storedVersion: base.schemaVersion ?? 1, fields, runtime: runtimeOf(base.runtime), invalid };
}

/** Fields directly inside `parentId` (null = top level), in stored order. */
export function childrenOf(fields: EngineField[], parentId: string | null): EngineField[] {
    return fields.filter((f) => f.parentId === parentId);
}

export const isFormArray = (f: Pick<EngineField, 'type'>) => f.type === 'FormArray';

/** Ids of every field inside a repeatable section (their values live in the rows, not at the top level). */
export function rowScopedIds(fields: EngineField[]): Set<string> {
    const byParent = new Map<string, EngineField[]>();
    fields.forEach((f) => f.parentId && byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]));
    const out = new Set<string>();
    const visit = (id: string) =>
        byParent.get(id)?.forEach((c) => {
            if (out.has(c.id)) return;
            out.add(c.id);
            visit(c.id);
        });
    fields.filter(isFormArray).forEach((a) => visit(a.id));
    return out;
}

/**
 * Whether a field is required now: always when the author set Required, or while its `requiredWhen` formula holds. The
 * formula reads like a computed field's: `form` and `row` are the values of `current` (the form, or the row the field is
 * in), `root` the whole form, plus `user`. A formula that fails to run does not make the field required.
 */
export function isRequiredIn(
    f: EngineField,
    current: Record<string, unknown>,
    root: Record<string, unknown>,
    scope: Record<string, unknown> = {}
): boolean {
    if (f.rules.required) return true;
    const when = f.rules.requiredWhen;
    return when ? evalCondition(when, { ...scope, form: current, row: current, root }) === true : false;
}
