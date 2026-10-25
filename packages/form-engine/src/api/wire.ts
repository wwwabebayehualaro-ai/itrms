/**
 * The forms API on the wire (task 0.16c): its DTOs as the engine receives them, and the mapping to the shapes the engine's
 * screens were built on (the legacy backend's). One place knows both: a screen never sees the wire, and a change of the
 * API changes this file only. The engine sits below the platform's slices, so it declares the wire types here instead of
 * importing `@itrms/forms/contracts` (the API's OpenAPI contract is their source).
 */
import type { FormSubmission, FormTemplate, PublishedForm } from '@itrms/schemas';
import type {
    FieldKind,
    FilterGroup,
    HistoryEntry,
    Op,
    QueryRequest,
    QueryResult,
    SavedView,
    ViewConfig,
    ViewSchema
} from '../viewer/types';

/** Paths of the forms API, relative to the app's `/api/` proxy. */
export const FORMS_API = {
    forms: 'v1/forms',
    publications: 'v1/form-publications',
    submissions: 'v1/submissions',
    savedViews: 'v1/saved-views'
} as const;

/**
 * The most rows the API exports at once (its MAX_DIRECT_EXPORT_ROWS); more go to the background. A hint only: a direct
 * export the API refuses goes to the background too.
 */
export const DIRECT_EXPORT_ROWS = 5000;

export type I18nText = Record<string, string>;

/** A change says which version it was based on: a concurrent edit is refused (409), never overwritten. */
export const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

export interface WireForm {
    id: string;
    version: number;
    key: string;
    name: I18nText;
    category: string | null;
    active: boolean;
    status: 'draft' | 'pending' | 'published';
    ownerUnit: { id: string; code: string; name: I18nText };
    publishedVersion: { id: string; number: number; publishedAt: string } | null;
    updatedAt: string;
    /** only on one form, never in a list */
    document?: unknown;
}

export interface WireVersion {
    id: string;
    formId: string;
    number: number;
    document: unknown;
    createdAt: string;
}

export interface WireSubmission {
    id: string;
    version: number;
    formId: string;
    formVersion: { id: string; number: number };
    caseId: string | null;
    handlingUnit: { id: string; code: string; name: I18nText };
    answers: Record<string, unknown>;
    submittedBy: string | null;
    submittedByName: string | null;
    createdAt: string;
    updatedAt: string;
}

/** The language the screens are shown in (the root layout sets it). */
export const pageLanguage = (): string => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';

/** A data name in the page's language, then English, then any. */
export const textOf = (text: I18nText | null | undefined, language = pageLanguage()): string =>
    text ? (text[language] ?? text.en ?? Object.values(text)[0] ?? '') : '';

/** An I18nText of one string (the builder edits one name until it has a translation table, task 0.17). */
export const textAll = (value: string): I18nText => ({ am: value, en: value });

/** A form key from a name: lower-case letters and digits joined by hyphens. */
export const keyOf = (name: string) =>
    name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || `form-${Date.now().toString(36)}`;

const STATUS: Record<WireForm['status'], NonNullable<FormTemplate['status']>> = {
    draft: 'draft',
    pending: 'pending_approval',
    published: 'published'
};

/** A form as the gallery, the builder and the settings show it. */
export function templateOf(form: WireForm): FormTemplate {
    return {
        id: form.id,
        name: textOf(form.name),
        names: form.name,
        slug: form.key,
        version: form.publishedVersion ? String(form.publishedVersion.number) : '',
        // a list carries no document: the builder reads it from the form itself
        form_config: (form.document as FormTemplate['form_config'] | undefined) ?? { fields: [] },
        category: form.category,
        is_active: form.active,
        file_relations: [],
        updated_at: form.updatedAt,
        row_version: form.version,
        status: STATUS[form.status],
        published_version_id: form.publishedVersion?.id ?? null,
        published_at: form.publishedVersion?.publishedAt ?? null
    };
}

/**
 * What a form's change sends: the fields the builder and the settings may change. A new name replaces the page
 * language's only, when the form's other names are known (`names`); the other languages keep theirs.
 */
export function formChangeOf(data: Partial<FormTemplate>) {
    return {
        ...(data.name !== undefined
            ? { name: data.names ? { ...data.names, [pageLanguage()]: data.name } : textAll(data.name) }
            : {}),
        ...(data.category !== undefined ? { category: data.category || null } : {}),
        ...(data.is_active !== undefined ? { active: data.is_active } : {}),
        ...(data.form_config !== undefined
            ? { document: Array.isArray(data.form_config) ? { fields: data.form_config } : data.form_config }
            : {})
    };
}

export function publishedOf(form: WireForm, version: WireVersion): PublishedForm {
    return {
        template_id: form.id,
        version_id: version.id,
        version: String(version.number),
        name: textOf(form.name),
        form_config: version.document as PublishedForm['form_config'],
        file_relations: [],
        published_at: form.publishedVersion?.publishedAt ?? null
    };
}

/** A submission as the request screens and the data viewer show it. */
export function submissionOf(s: WireSubmission): FormSubmission & {
    submitted_by_name: string | null;
    handling_unit: string;
    handling_unit_name: string;
} {
    return {
        id: s.id,
        template_id: s.formId,
        submission_data: s.answers,
        submitted_by: s.submittedBy,
        submitted_by_name: s.submittedByName,
        handling_unit: s.handlingUnit.id,
        handling_unit_name: textOf(s.handlingUnit.name) || s.handlingUnit.code,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        version: s.formVersion.number
    };
}

/**
 * The built-in fields: the screens' keys and the API's. A form's own field keys are the same on both sides (a form's
 * key can never be a built-in's).
 */
const BUILTINS: Record<string, string> = {
    created_at: 'createdAt',
    submitted_by: 'submittedBy',
    handling_unit: 'handlingUnit'
};
const SCREEN_KEYS = Object.fromEntries(Object.entries(BUILTINS).map(([screen, wire]) => [wire, screen]));

export const toWireKey = (key: string) => BUILTINS[key] ?? key;
export const toScreenKey = (key: string) => SCREEN_KEYS[key] ?? key;

interface WireCondition {
    field: string;
    op: string;
    value?: unknown;
}
interface WireGroup {
    op: 'and' | 'or';
    items: (WireCondition | WireGroup)[];
}

/** A filter with its built-in keys renamed (`map` is toWireKey going out, toScreenKey coming back). */
export function filterKeys<T extends WireGroup>(group: T | undefined, map: (key: string) => string): T | undefined {
    if (!group) return undefined;
    const walk = (node: WireCondition | WireGroup): WireCondition | WireGroup =>
        'items' in node ? { op: node.op, items: node.items.map(walk) } : { ...node, field: map(node.field) };
    return walk(group) as T;
}

export const sortKeys = <T extends { field: string; desc?: boolean }>(
    sort: T[] | undefined,
    map: (key: string) => string
) => (sort ?? []).map((s) => ({ field: map(s.field), desc: s.desc ?? false }));

// ---- the data viewer: its schema, its queries and their results ----

export interface WireViewField {
    key: string;
    label: string;
    kind: string;
    builtin: boolean;
    ops: string[];
    sortable: boolean;
    groupable: boolean;
    aggregatable: boolean;
    options: { value: unknown; label: string }[];
    currency: string | null;
    type: string | null;
    filterable: boolean;
    indexed: boolean;
}

export interface WireViewSchema {
    fields: WireViewField[];
    roles: {
        title: string | null;
        subtitle: string | null;
        stage: string;
        date: string | null;
        dateEnd: string | null;
        measures: string[];
        people: string[];
        files: string[];
        rows: string[];
    };
    modes: string[];
}

const screenKeyOrNull = (key: string | null) => (key === null ? null : toScreenKey(key));

/**
 * The view schema with the screens' keys. The office is a choice among the offices in the data (its options carry their
 * names), so the viewer filters, groups and labels it as any choice.
 */
export function viewSchemaOf(s: WireViewSchema): ViewSchema {
    return {
        fields: s.fields.map((f) => ({
            key: toScreenKey(f.key),
            label: f.label,
            kind: (f.kind === 'unit' ? 'choice' : f.kind) as FieldKind,
            person: f.kind === 'person',
            builtin: f.builtin,
            ops: f.ops as Op[],
            sortable: f.sortable,
            groupable: f.groupable,
            aggregatable: f.aggregatable,
            options: f.options.map((o) => ({ value: String(o.value), label: o.label })),
            currency: f.currency,
            ...(f.type ? { type: f.type } : {}),
            filterable: f.filterable,
            indexed: f.indexed
        })),
        roles: {
            title: screenKeyOrNull(s.roles.title),
            subtitle: screenKeyOrNull(s.roles.subtitle),
            stage: toScreenKey(s.roles.stage),
            date: screenKeyOrNull(s.roles.date),
            dateEnd: screenKeyOrNull(s.roles.dateEnd),
            measures: s.roles.measures.map(toScreenKey),
            people: s.roles.people.map(toScreenKey),
            files: s.roles.files.map(toScreenKey),
            rows: s.roles.rows.map(toScreenKey)
        },
        modes: s.modes
    };
}

const dimensionOf = (d: QueryRequest['group_by']) => (d ? { ...d, field: toWireKey(d.field) } : undefined);

/** A viewer query as the API takes it. */
export function queryOf(req: QueryRequest) {
    return {
        formId: req.template_id,
        ...(req.filter ? { filter: filterKeys(req.filter, toWireKey) } : {}),
        ...(req.search ? { search: req.search } : {}),
        ...(req.sort ? { sort: sortKeys(req.sort, toWireKey) } : {}),
        ...(req.page !== undefined ? { page: req.page } : {}),
        ...(req.page_size !== undefined ? { pageSize: req.page_size } : {}),
        ...(req.aggregates
            ? {
                  aggregates: req.aggregates.map((a) => ({
                      ...a,
                      ...(a.field !== undefined ? { field: toWireKey(a.field) } : {})
                  }))
              }
            : {}),
        ...(req.group_by ? { groupBy: dimensionOf(req.group_by) } : {}),
        ...(req.then_by ? { thenBy: dimensionOf(req.then_by) } : {}),
        ...(req.facets ? { facets: req.facets.map(toWireKey) } : {}),
        ...(req.rows !== undefined ? { rows: req.rows } : {})
    };
}

export interface WireQueryResult {
    items: WireSubmission[];
    total: number;
    page: number;
    pageSize: number;
    aggregates: Record<string, number | null>;
    groups: { key: string | null; key2: string | null; count: number; aggregates: Record<string, number | null> }[];
    facets: Record<string, { value: string | null; count: number }[]>;
}

export function resultOf(r: WireQueryResult): QueryResult {
    return {
        items: r.items.map(submissionOf),
        total: r.total,
        page: r.page,
        page_size: r.pageSize,
        aggregates: r.aggregates,
        groups: r.groups,
        facets: Object.fromEntries(Object.entries(r.facets).map(([k, v]) => [toScreenKey(k), v]))
    };
}

// ---- a request's history and the saved views ----

export interface WireHistory {
    items: {
        id: string;
        action: string;
        at: string;
        actorId: string | null;
        actorName: string | null;
        changes: string[];
    }[];
    truncated: boolean;
}

export const historyOf = (h: WireHistory): HistoryEntry[] =>
    h.items.map((e) => ({
        id: e.id,
        action: e.action,
        occurred_at: e.at,
        actor_id: e.actorId,
        actor_name: e.actorName,
        changes: e.changes.map((field) => ({ field }))
    }));

export interface WireViewConfig {
    mode: string;
    search?: string;
    filter?: { op: 'and' | 'or'; items: unknown[] };
    sort: { field: string; desc: boolean }[];
    columns: string[];
    pageSize: number;
    options: Record<string, unknown>;
}

export interface WireSavedView {
    id: string;
    version: number;
    formId: string;
    name: string;
    visibility: 'private' | 'unit';
    isDefault: boolean;
    config: WireViewConfig;
    ownerId: string | null;
    canEdit: boolean;
}

/** A shared view is the office's (`unit` on the wire). */
export const visibilityOf = (v: WireSavedView['visibility']): SavedView['visibility'] =>
    v === 'unit' ? 'shared' : 'private';
export const toWireVisibility = (v: SavedView['visibility']): WireSavedView['visibility'] =>
    v === 'shared' ? 'unit' : 'private';

export const viewConfigOf = (c: WireViewConfig): ViewConfig => ({
    mode: c.mode,
    search: c.search ?? '',
    filter: filterKeys(c.filter as FilterGroup | undefined, toScreenKey) ?? { op: 'and', items: [] },
    sort: sortKeys(c.sort, toScreenKey),
    columns: c.columns.map(toScreenKey),
    page_size: c.pageSize,
    options: c.options
});

export const toWireConfig = (c: ViewConfig): WireViewConfig => ({
    mode: c.mode,
    ...(c.search ? { search: c.search } : {}),
    ...(c.filter.items.length ? { filter: filterKeys(c.filter, toWireKey) } : {}),
    sort: sortKeys(c.sort, toWireKey),
    columns: c.columns.map(toWireKey),
    pageSize: c.page_size,
    options: c.options
});

export const savedViewOf = (v: WireSavedView): SavedView => ({
    id: v.id,
    template_id: v.formId,
    name: v.name,
    visibility: visibilityOf(v.visibility),
    is_default: v.isDefault,
    config: viewConfigOf(v.config),
    owner_name: null,
    can_edit: v.canEdit,
    row_version: v.version
});
