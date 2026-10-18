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
import { z } from 'zod';
import type { VisibilityCondition, Action, FormField } from './storedTypes';
import type { FieldOptionsBinding, FieldRowsBinding, TemplateRuntimeConfig } from '../Runtime/types';

/** Version of the stored document this engine writes. Documents without a version are the original builder format (1). */
export const SCHEMA_VERSION = 2;

const conditionSchema: z.ZodType<VisibilityCondition> = z.lazy(() =>
    z
        .object({
            field: z.string().default(''),
            operator: z.string(),
            value: z.unknown().optional(),
            logic: z.enum(['and', 'or', 'xor']).optional(),
            conditions: z.array(conditionSchema).optional(),
            clientOnly: z.boolean().optional(),
            serverOnly: z.boolean().optional()
        })
        .loose()
) as unknown as z.ZodType<VisibilityCondition>;

/** One stored field. Lenient on purpose: unknown keys are kept, so reading and writing a document never loses data. */
export const storedFieldSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform(String),
        type: z.string(),
        category: z.string().optional(),
        label: z.string().optional().nullable(),
        parentId: z.union([z.string(), z.number()]).optional().nullable(),
        props: z.record(z.string(), z.unknown()).optional().nullable(),
        data: z
            .object({
                defaultProps: z.record(z.string(), z.unknown()).optional().nullable(),
                dataSource: z.object({ staticData: z.unknown().optional() }).loose().optional().nullable(),
                optionsBinding: z.object({ dataSourceId: z.string() }).loose().optional().nullable(),
                rowsBinding: z.object({ dataSourceId: z.string() }).loose().optional().nullable(),
                computed: z.object({ expression: z.string(), readOnly: z.boolean().optional() }).loose().optional().nullable()
            })
            .loose()
            .optional()
            .nullable(),
        behavior: z
            .object({
                validation: z
                    .object({
                        supported: z.boolean().optional(),
                        types: z.array(z.string()).optional().nullable(),
                        rules: z.record(z.string(), z.unknown()).optional().nullable(),
                        errorMessages: z.record(z.string(), z.string()).optional().nullable(),
                        remote: z.object({ dataSourceId: z.string(), message: z.string().optional() }).loose().optional().nullable()
                    })
                    .loose()
                    .optional()
                    .nullable(),
                visibilityConditions: z.array(conditionSchema).optional().nullable(),
                enabledConditions: z.array(conditionSchema).optional().nullable(),
                actions: z.record(z.string(), z.array(z.unknown())).optional().nullable()
            })
            .loose()
            .optional()
            .nullable(),
        layout: z
            .object({ options: z.object({ isContainer: z.boolean().optional() }).loose().optional().nullable() })
            .loose()
            .optional()
            .nullable(),
        metadata: z.object({ description: z.string().optional() }).loose().optional().nullable(),
        visibleToRoles: z.array(z.string()).optional().nullable()
    })
    .loose();

export type StoredField = z.infer<typeof storedFieldSchema>;

export const formDocumentSchema = z
    .object({
        schemaVersion: z.number().int().optional(),
        fields: z.array(z.unknown()).default([]),
        runtime: z.unknown().optional()
    })
    .loose();

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

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function staticOptions(f: StoredField, props: Record<string, unknown>): FieldOption[] {
    const raw = (f.data?.dataSource?.staticData as unknown) ?? props.options ?? [];
    if (!Array.isArray(raw)) return [];
    return raw
        .map((o): FieldOption | null => {
            if (o && typeof o === 'object') {
                const r = o as Record<string, unknown>;
                return { label: String(r.label ?? r.value ?? ''), value: r.value, disabled: r.disabled === true || undefined, items: Array.isArray(r.items) ? (r.items as FieldOption[]) : undefined };
            }
            return typeof o === 'string' || typeof o === 'number' ? { label: String(o), value: o } : null;
        })
        .filter((o): o is FieldOption => !!o && (o.label !== '' || (o.value !== '' && o.value !== undefined)));
}

/** One stored field → the engine's view of it. */
export function toEngineField(stored: StoredField): EngineField {
    const defaults = (stored.data?.defaultProps ?? {}) as Record<string, unknown>;
    const props: Record<string, unknown> = { ...defaults, ...(stored.props ?? {}) };
    const v = stored.behavior?.validation;
    const types = v?.types ?? [];
    const rules = (v?.rules ?? {}) as Record<string, unknown>;
    // "Required" is the field's Required property; templates that never had it fall back to the palette's rule list
    const required = props.required === undefined ? types.includes('required') : Boolean(props.required);
    const minItems = num(props.minItems);
    const maxItems = num(props.maxItems);

    return {
        id: stored.id,
        type: stored.type,
        category: stored.category ?? 'Input',
        label: stored.label ?? '',
        parentId: stored.parentId === undefined || stored.parentId === null || stored.parentId === '' ? null : String(stored.parentId),
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
            pattern: typeof rules.pattern === 'string' && rules.pattern.length > 0 && rules.pattern.length <= 200 ? rules.pattern : undefined,
            patternMessage: typeof rules.patternMessage === 'string' && rules.patternMessage ? rules.patternMessage : undefined,
            min: num(rules.min),
            max: num(rules.max),
            minDate: props.minDate || undefined,
            maxDate: props.maxDate || undefined,
            maxFileSize: num(props.maxFileSize),
            accept: typeof props.accept === 'string' && props.accept ? props.accept : undefined,
            minItems: minItems !== undefined ? Math.max(0, minItems) : 0,
            maxItems: maxItems !== undefined && maxItems > 0 ? maxItems : Infinity
        },
        messages: (v?.errorMessages ?? {}) as Record<string, string>,
        visibleWhen: (stored.behavior?.visibilityConditions ?? []) as VisibilityCondition[],
        enabledWhen: (stored.behavior?.enabledConditions ?? []) as VisibilityCondition[],
        computed: stored.data?.computed?.expression ? { expression: stored.data.computed.expression, readOnly: stored.data.computed.readOnly } : undefined,
        remote: v?.remote?.dataSourceId ? { dataSourceId: v.remote.dataSourceId, message: v.remote.message || undefined } : undefined,
        options: staticOptions(stored, props),
        optionsBinding: (stored.data?.optionsBinding ?? undefined) as FieldOptionsBinding | undefined,
        rowsBinding: (stored.data?.rowsBinding ?? undefined) as FieldRowsBinding | undefined,
        actions: (stored.behavior?.actions ?? {}) as Record<string, Action[]>,
        visibleToRoles: stored.visibleToRoles ?? undefined,
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
export function readDocument(raw: unknown): EngineDocument {
    const doc = Array.isArray(raw) ? { fields: raw } : raw && typeof raw === 'object' ? raw : {};
    const parsed = formDocumentSchema.safeParse(doc);
    const base = parsed.success ? parsed.data : { fields: [] as unknown[], schemaVersion: undefined, runtime: undefined };
    const fields: EngineField[] = [];
    const invalid: EngineDocument['invalid'] = [];
    const seen = new Set<string>();
    base.fields.forEach((f, index) => {
        const r = storedFieldSchema.safeParse(f);
        if (!r.success) return invalid.push({ index, message: r.error.issues[0]?.message ?? 'invalid field' });
        if (seen.has(r.data.id)) return invalid.push({ index, message: `duplicate field id "${r.data.id}"` });
        seen.add(r.data.id);
        fields.push(toEngineField(r.data));
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
