import type { VisibilityCondition } from '../core/conditionTypes';

/**
 * Declarative, JSON-serialisable runtime model persisted in `form_config.runtime`.
 * Nothing here may contain secrets: authentication is always delegated to the
 * application's shared HTTP client.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RuntimeRequestConfig {
    method: HttpMethod;
    /** Relative path (resolved against the app backend). Supports `{{...}}` bindings and `{name}` path params. */
    url: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
    contentType?: 'application/json' | 'application/x-www-form-urlencoded' | 'multipart/form-data';
}

export interface OptionMapping {
    /** Path to the array inside the response, e.g. `data.items`. Empty = response itself. */
    itemsPath?: string;
    labelPath?: string;
    valuePath?: string;
    disabledPath?: string;
    /** Path to child array for tree-shaped data. */
    childrenPath?: string;
}

export interface ResponseMapping {
    /** Path to the payload inside the response, e.g. `data`. */
    path?: string;
    options?: OptionMapping;
    /** Map response fields onto form fields after a successful load / mutation: { fieldId: 'path.in.response' }. */
    toForm?: Record<string, string>;
    /** Declarative transforms applied in order; no user code is executed. */
    transforms?: Array<
        | { op: 'pick'; paths: string[] }
        | { op: 'rename'; from: string; to: string }
        | { op: 'default'; path: string; value: unknown }
        | { op: 'filter'; path?: string; where: VisibilityCondition }
    >;
}

export interface ErrorMapping {
    /** Path to a message inside the error response body. */
    messagePath?: string;
    /** Fallback message shown to the user. */
    message?: string;
    /** Map HTTP status -> message. */
    statusMessages?: Record<string, string>;
}

export interface DataSourceDefinition {
    id: string;
    name?: string;
    request: RuntimeRequestConfig;
    auth?: 'app' | 'none';
    timeoutMs?: number;
    retry?: { attempts: number; delayMs: number; backoffFactor?: number };
    /** Extra references that must be resolved (non-empty) before fetching, on top of those detected in the request. */
    dependsOn?: string[];
    /** Fetch only when these conditions hold (evaluated against the runtime context). */
    enabledWhen?: VisibilityCondition[];
    cache?: { staleTimeMs?: number; gcTimeMs?: number };
    refetch?: { onMount?: boolean; onWindowFocus?: boolean; intervalMs?: number };
    responseMapping?: ResponseMapping;
    errorMapping?: ErrorMapping;
    /** Load the mapped result into the form once, after the first successful fetch. */
    loadIntoForm?: boolean;
}

export interface RuntimeVariable {
    name: string;
    /** A literal or a `{{...}}` binding evaluated against form/data/user/route. */
    value: unknown;
}

export interface SubmitConfig {
    /** Data source id of type mutation (method != GET) invoked on submit. Omit to use the default backend submission. */
    dataSourceId?: string;
    /** Body template; defaults to `{{form}}`. */
    body?: unknown;
    /** Skip the default template-submission (form/submissions) call and only run the configured API. */
    skipDefaultSubmission?: boolean;
    resetOnSuccess?: boolean;
    /** Shown after a successful submit; `{{response.*}}` is what the save returned (e.g. `{{response.submission_data.reference}}`). */
    successMessage?: string;
    /** A server action (`GET /form/server-actions`) the backend runs with the request, in the same transaction (e.g. a posting). */
    serverAction?: string;
    /** Data source ids to refetch after success. */
    refetch?: string[];
}

/** The `runtime` block of a stored form (`form_config.runtime`), or undefined when it has none. */
export function getRuntimeConfig(formConfig: unknown): TemplateRuntimeConfig | undefined {
    const rt =
        formConfig && typeof formConfig === 'object' && !Array.isArray(formConfig)
            ? (formConfig as { runtime?: TemplateRuntimeConfig }).runtime
            : undefined;
    return rt && Array.isArray(rt.dataSources) ? rt : undefined;
}

export interface TemplateRuntimeConfig {
    dataSources: DataSourceDefinition[];
    variables?: RuntimeVariable[];
    submit?: SubmitConfig;
}

/** Per-field binding to a data source for option-driven inputs. */
export interface FieldOptionsBinding {
    dataSourceId: string;
    mapping?: OptionMapping;
    /** Clear the field value when it is no longer among the fetched options. */
    clearOnInvalid?: boolean;
    emptyMessage?: string;
}

/** Rows for a display field (DataTable) come from a template-level data source. */
export interface FieldRowsBinding {
    dataSourceId: string;
    /** Array inside the response. Default: the response itself when it is an array, otherwise its `items`. */
    itemsPath?: string;
    emptyMessage?: string;
}

export type ColumnType =
    'text' | 'date' | 'datetime' | 'currency' | 'number' | 'boolean' | 'tag' | 'tags' | 'lookup' | 'count' | 'files';

/** One column of a data-driven table. `field` is a dotted path into the row, e.g. `submission_data.manager`. */
export interface TableColumn {
    field: string;
    header: string;
    type?: ColumnType;
    /** `lookup` / `tags`: id -> label through another data source (e.g. a user id shown as a name). */
    lookupSource?: string;
    /** `currency`: ISO code (default USD). */
    currency?: string;
    sortable?: boolean;
    /** Max width of the cell (CSS), long text is cut with an ellipsis. */
    width?: string;
}

export interface RuntimeContext {
    form: Record<string, any>;
    data: Record<string, any>;
    user: Record<string, any>;
    route: Record<string, any>;
    variables: Record<string, any>;
}

export const EMPTY_RUNTIME: TemplateRuntimeConfig = { dataSources: [], variables: [] };
