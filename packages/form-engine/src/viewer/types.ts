import type { FormSubmission } from '@itrms/schemas';
/** Contract of the data viewer. Mirrors Backend `submission_fields.describe` and `form_submission_query_schema`. */

export type FieldKind =
    'text' | 'choice' | 'multi' | 'number' | 'date' | 'datetime' | 'boolean' | 'files' | 'rows' | 'person';
export type Op =
    | 'eq'
    | 'ne'
    | 'contains'
    | 'ncontains'
    | 'starts'
    | 'in'
    | 'nin'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'has'
    | 'hasany'
    | 'empty'
    | 'notempty';
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
export type Bucket = 'year' | 'month' | 'day';

export interface ViewOption {
    value: string;
    label: string;
}

export interface ViewField {
    key: string;
    label: string;
    kind: FieldKind;
    /** Stores a user id (directory-bound choice or built-in submitter): show the person's name. */
    person: boolean;
    builtin: boolean;
    ops: Op[];
    sortable: boolean;
    groupable: boolean;
    aggregatable: boolean;
    options: ViewOption[];
    currency?: string | null;
    type?: string;
}

export interface ViewRoles {
    title: string | null;
    subtitle: string | null;
    /** Field that moves a request through a process: the board's columns. Falls back to the built-in `status`. */
    stage: string;
    date: string | null;
    dateEnd: string | null;
    measures: string[];
    people: string[];
    files: string[];
    rows: string[];
}

export interface ViewSchema {
    fields: ViewField[];
    roles: ViewRoles;
    modes: string[];
}

export interface Condition {
    field: string;
    op: Op;
    value?: unknown;
}
export interface FilterGroup {
    op: 'and' | 'or';
    items: (Condition | FilterGroup)[];
}
export const isGroup = (n: Condition | FilterGroup): n is FilterGroup => 'items' in n;
export const EMPTY_FILTER: FilterGroup = { op: 'and', items: [] };

export interface SortKey {
    field: string;
    desc?: boolean;
}
export interface Aggregate {
    fn: AggFn;
    field?: string;
    alias?: string;
}

export interface QueryRequest {
    template_id: string;
    filter?: FilterGroup;
    search?: string;
    sort?: SortKey[];
    page?: number;
    page_size?: number;
    aggregates?: Aggregate[];
    group_by?: { field: string; bucket?: Bucket };
    /** A second dimension (pivot columns). */
    then_by?: { field: string; bucket?: Bucket };
    facets?: string[];
    rows?: boolean;
}

export interface ViewRow extends FormSubmission {
    submitted_by_name?: string | null;
}

export interface QueryResult {
    items: ViewRow[];
    total: number;
    page: number;
    page_size: number;
    aggregates: Record<string, number | null>;
    groups: { key: string | null; key2?: string | null; count: number; aggregates: Record<string, number | null> }[];
    facets: Record<string, { value: string | null; count: number }[]>;
}

/** Everything a view needs to know about what the user asked for. Lives in the URL so a view can be shared by link. */
export interface ViewState {
    mode: string;
    search: string;
    filter: FilterGroup;
    sort: SortKey[];
    page: number;
    pageSize: number;
    /** Table: visible column keys (empty = the default columns). */
    columns: string[];
    /** Mode-specific settings (group-by, measure, month shown...). */
    options: Record<string, unknown>;
    /** The saved view this link was made from (applied when the link carries nothing else). */
    viewId?: string;
}
