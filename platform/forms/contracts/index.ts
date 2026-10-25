/**
 * Public entry of @itrms/forms (code-structure.md §4): the DTOs and events of form definitions, their versions and
 * publications, and submissions. One source per fact: these schemas validate the API's input and output and write the
 * OpenAPI document.
 *
 * A definition holds a working copy (`document`). Publishing snapshots it as an immutable, content-hashed version; a second
 * person approves before people fill it in (SEC-AC-6). A submission names the version it was filled on and keeps it.
 */
import { i18nTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** A stored form is at most this big as JSON (under the API's 1 MiB body limit; the contract caps it at 1000 fields). */
export const MAX_DOCUMENT_BYTES = 960 * 1024;
/** A submission's answers are at most this big as JSON. */
export const MAX_ANSWERS_BYTES = 512 * 1024;
/** How deep a document or answers may nest, and how many array items they may hold in all (SEC-IN-2). */
export const MAX_DEPTH = 12;
export const MAX_ITEMS = 5000;

// contracts run in the browser too: no Buffer
const utf8 = new TextEncoder();

/** Why a JSON value is refused (too big, too deep, too many items, or a NUL, which PostgreSQL cannot store), or null. */
function jsonProblem(value: unknown, maxBytes: number): string | null {
    let items = 0;
    const walk = (v: unknown, depth: number): string | null => {
        if (depth > MAX_DEPTH) return `nested more than ${MAX_DEPTH} levels`;
        if (Array.isArray(v)) {
            items += v.length;
            if (items > MAX_ITEMS) return `more than ${MAX_ITEMS} items`;
            for (const x of v) {
                const p = walk(x, depth + 1);
                if (p) return p;
            }
        } else if (v && typeof v === 'object') {
            for (const x of Object.values(v)) {
                const p = walk(x, depth + 1);
                if (p) return p;
            }
        }
        return null;
    };
    const shape = walk(value, 0);
    if (shape) return shape;
    const json = JSON.stringify(value) ?? '';
    // JSON writes a NUL as the escape \u0000
    if (json.includes('\\u0000')) return 'a text holds a NUL character';
    return utf8.encode(json).length > maxBytes ? `larger than ${Math.round(maxBytes / 1024)} KB` : null;
}

const boundedJson = <T extends z.ZodType>(schema: T, maxBytes: number) =>
    schema.superRefine((v, ctx) => {
        const problem = jsonProblem(v, maxBytes);
        if (problem) ctx.addIssue({ code: 'custom', message: problem });
    });

/** The engine's document (`{ schemaVersion?, fields, runtime? }`, or the oldest bare field list); the API checks it. */
export const formDocumentInputSchema = boundedJson(
    z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    MAX_DOCUMENT_BYTES
);

/** A form's name: Amharic and English, at most 10 languages of 200 characters. */
export const formNameSchema = i18nTextSchema.refine(
    (t) => Object.keys(t).length <= 10 && Object.values(t).every((v) => typeof v === 'string' && v.length <= 200),
    'at most 10 languages of 200 characters'
);

/** A definition's key: lower-case words joined by hyphens, unique in the region (`driving-licence-application`). */
export const formKeySchema = z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case letters and digits, joined by hyphens');

export const FORM_STATUSES = ['draft', 'pending', 'published'] as const;

export const formCreateSchema = z.strictObject({
    key: formKeySchema,
    name: formNameSchema,
    category: z.string().trim().min(1).max(100).optional(),
    document: formDocumentInputSchema
});

export const formUpdateSchema = z
    .strictObject({
        name: formNameSchema.optional(),
        category: z.string().trim().min(1).max(100).nullable().optional(),
        active: z.boolean().optional(),
        document: formDocumentInputSchema.optional()
    })
    .refine((u) => Object.keys(u).length > 0, 'nothing to change');

export const formListQuerySchema = z.strictObject({
    q: z.string().trim().max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const formSummarySchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    key: z.string(),
    name: z.record(z.string(), z.string()),
    category: z.string().nullable(),
    active: z.boolean(),
    /** draft: the working copy is not what people fill in; pending: a publication waits for approval */
    status: z.enum(FORM_STATUSES),
    ownerUnit: unitRefSchema,
    publishedVersion: z.object({ id: z.uuid(), number: z.number().int(), publishedAt: z.string() }).nullable(),
    updatedAt: z.string()
});

export const formSchema = formSummarySchema.extend({ document: z.unknown(), documentHash: z.string() });

export const formVersionSchema = z.object({
    id: z.uuid(),
    formId: z.uuid(),
    number: z.number().int(),
    contentHash: z.string(),
    document: z.unknown(),
    createdAt: z.string(),
    createdBy: z.uuid().nullable()
});

export const formVersionSummarySchema = formVersionSchema.omit({ document: true }).extend({ published: z.boolean() });

/** withdrawn: the person who asked took the request back */
export const PUBLICATION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

export const publicationRequestSchema = z.strictObject({
    /** for the approver: what changed and why */
    note: z.string().trim().min(1).max(500).optional()
});

export const publicationDecisionSchema = z.strictObject({ note: z.string().trim().min(1).max(500).optional() });

export const publicationListQuerySchema = z.strictObject({
    status: z.enum(PUBLICATION_STATUSES).default('pending'),
    formId: z.uuid().optional()
});

export const publicationSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    formId: z.uuid(),
    formName: z.record(z.string(), z.string()),
    formVersion: z.object({ id: z.uuid(), number: z.number().int() }),
    status: z.enum(PUBLICATION_STATUSES),
    note: z.string().nullable(),
    requestedBy: z.uuid().nullable(),
    requestedAt: z.string(),
    decidedBy: z.uuid().nullable(),
    decidedAt: z.string().nullable(),
    decisionNote: z.string().nullable()
});

/** Answers keyed by field id, as the engine writes them; only the form's own fields are kept. */
export const answersSchema = boundedJson(z.record(z.string().max(200), z.unknown()), MAX_ANSWERS_BYTES);

export const submissionCreateSchema = z.strictObject({
    formId: z.uuid(),
    /** the version the person filled in: it must still be the published one */
    formVersionId: z.uuid(),
    answers: answersSchema
});

export const submissionUpdateSchema = z.strictObject({ answers: answersSchema });

export const submissionListQuerySchema = z.strictObject({
    formId: z.uuid(),
    /** only what the signed-in person submitted */
    mine: z.enum(['true', 'false']).optional(),
    /** the last id of the previous page: the next page starts after it (newest first) */
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const submissionSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    formId: z.uuid(),
    formVersion: z.object({ id: z.uuid(), number: z.number().int() }),
    caseId: z.uuid().nullable(),
    handlingUnit: unitRefSchema,
    answers: z.record(z.string(), z.unknown()),
    submittedBy: z.uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});

export type FormSummary = z.infer<typeof formSummarySchema>;
export type Form = z.infer<typeof formSchema>;
export type FormVersion = z.infer<typeof formVersionSchema>;
export type FormVersionSummary = z.infer<typeof formVersionSummarySchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Submission = z.infer<typeof submissionSchema>;

/** A version became the one people fill in (0.16b creates the indexes of its filterable fields). */
export const formPublishedV1 = z.strictObject({
    formId: z.uuid(),
    formVersionId: z.uuid(),
    previousVersionId: z.uuid().nullable(),
    publicationId: z.uuid()
});

/** A background export was asked for: the worker makes its file (task 0.16e). */
export const submissionExportRequestedV1 = z.strictObject({ exportId: z.uuid() });

export const FORMS_EVENTS = {
    'form.published.v1': formPublishedV1,
    'submission-export.requested.v1': submissionExportRequestedV1
} as const;

// ---- queries over a form's submissions (task 0.16b) ----

/** The bounds of one query (SEC-IN-2): conditions, nesting, list sizes, search, sort keys, groups and facets. */
export const QUERY_LIMITS = {
    conditions: 50,
    depth: 4,
    list: 200,
    search: 100,
    sort: 3,
    aggregates: 8,
    facets: 5,
    facetValues: 50,
    groups: 200,
    groups2d: 600,
    pageSize: 100
} as const;

export const QUERY_OPS = [
    'eq',
    'ne',
    'contains',
    'ncontains',
    'starts',
    'in',
    'nin',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'has',
    'hasany',
    'empty',
    'notempty'
] as const;

const fieldKeySchema = z.string().min(1).max(64);

export const queryConditionSchema = z.strictObject({
    field: fieldKeySchema,
    op: z.enum(QUERY_OPS),
    value: z.unknown().optional()
});

export interface QueryGroup {
    op: 'and' | 'or';
    items: (z.infer<typeof queryConditionSchema> | QueryGroup)[];
}

/**
 * A filter: conditions and groups nested at most QUERY_LIMITS.depth levels below the top. The levels are written out,
 * not recursive, so a body nested any deeper is refused by its shape before anything walks it.
 */
function groupAt(level: number): z.ZodType<QueryGroup> {
    const item =
        level >= QUERY_LIMITS.depth ? queryConditionSchema : z.union([queryConditionSchema, groupAt(level + 1)]);
    return z.strictObject({
        op: z.enum(['and', 'or']).default('and'),
        items: z.array(item).max(QUERY_LIMITS.conditions)
    });
}

export const queryGroupSchema = groupAt(0);

const dimensionSchema = z.strictObject({
    field: fieldKeySchema,
    /** dates only */
    bucket: z.enum(['year', 'month', 'day']).optional()
});

export const submissionQuerySchema = z.strictObject({
    formId: z.uuid(),
    filter: queryGroupSchema.optional(),
    search: z.string().max(QUERY_LIMITS.search).optional(),
    sort: z
        .array(z.strictObject({ field: fieldKeySchema, desc: z.boolean().default(false) }))
        .max(QUERY_LIMITS.sort)
        .default([]),
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(QUERY_LIMITS.pageSize).default(20),
    /** over everything the filter matches (KPI tiles) */
    aggregates: z
        .array(
            z.strictObject({
                fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
                field: fieldKeySchema.optional(),
                alias: z
                    .string()
                    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/)
                    .optional()
            })
        )
        .max(QUERY_LIMITS.aggregates)
        .default([]),
    groupBy: dimensionSchema.optional(),
    /** a second dimension (pivot columns); only with groupBy */
    thenBy: dimensionSchema.optional(),
    /** fields to count the values of (filter sidebars, board columns) */
    facets: z.array(fieldKeySchema).max(QUERY_LIMITS.facets).default([]),
    /** false: totals, groups and facets only (dashboards, boards) */
    rows: z.boolean().default(true)
});

export type SubmissionQuery = z.infer<typeof submissionQuerySchema>;

const groupKey = z.string().nullable();

export const submissionQueryResultSchema = z.object({
    items: z.array(submissionSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    aggregates: z.record(z.string(), z.number().nullable()),
    groups: z.array(
        z.object({
            key: groupKey,
            key2: groupKey,
            count: z.number().int(),
            aggregates: z.record(z.string(), z.number().nullable())
        })
    ),
    facets: z.record(z.string(), z.array(z.object({ value: groupKey, count: z.number().int() })))
});

export type SubmissionQueryResult = z.infer<typeof submissionQueryResultSchema>;

// ---- saved views, exports and history (task 0.16d) ----

export const VIEW_MODES = ['table', 'cards', 'board', 'calendar', 'pivot', 'dashboard'] as const;
export const VIEW_VISIBILITIES = ['private', 'unit'] as const;

/** What a view keeps: the query's parts, the columns shown and the mode's own options (bounded). */
export const viewConfigSchema = z.strictObject({
    mode: z.enum(VIEW_MODES).default('table'),
    search: z.string().max(QUERY_LIMITS.search).optional(),
    filter: queryGroupSchema.optional(),
    sort: z
        .array(z.strictObject({ field: fieldKeySchema, desc: z.boolean().default(false) }))
        .max(QUERY_LIMITS.sort)
        .default([]),
    /** the DataGrid's column choice, in order */
    columns: z.array(fieldKeySchema).max(50).default([]),
    pageSize: z.number().int().min(1).max(QUERY_LIMITS.pageSize).default(20),
    /** a mode's own settings (the board's grouping, the calendar's month) */
    options: boundedJson(z.record(z.string().max(64), z.unknown()), 4096).default({})
});

const viewName = z.string().trim().min(1).max(100);

export const savedViewCreateSchema = z.strictObject({
    name: viewName,
    /** private: its owner's; unit: everyone of the unit who reads the form's submissions (sharing needs the right) */
    visibility: z.enum(VIEW_VISIBILITIES).default('private'),
    /** the view the unit opens the form's data with (a shared view only) */
    isDefault: z.boolean().default(false),
    config: viewConfigSchema
});

export const savedViewUpdateSchema = z
    .strictObject({
        name: viewName.optional(),
        visibility: z.enum(VIEW_VISIBILITIES).optional(),
        isDefault: z.boolean().optional(),
        config: viewConfigSchema.optional()
    })
    .refine((u) => Object.keys(u).length > 0, 'nothing to change');

export const savedViewSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    formId: z.uuid(),
    unitId: z.uuid(),
    name: z.string(),
    visibility: z.enum(VIEW_VISIBILITIES),
    isDefault: z.boolean(),
    config: viewConfigSchema,
    ownerId: z.uuid().nullable(),
    /** the caller may change or delete it */
    canEdit: z.boolean(),
    updatedAt: z.string()
});

export type SavedView = z.infer<typeof savedViewSchema>;

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
/** The most rows an export answers directly; more go to the background export (task 0.16e). */
export const MAX_DIRECT_EXPORT_ROWS = 5000;
/** The most rows a background export makes into a file, and how long the file is kept for its requester. */
export const MAX_BACKGROUND_EXPORT_ROWS = 100_000;
export const EXPORT_KEEP_DAYS = 7;

/** What the viewer shows, as a file: the same filter, search and sort, the chosen fields (all by default). */
export const submissionExportSchema = z.strictObject({
    formId: z.uuid(),
    format: z.enum(EXPORT_FORMATS).default('csv'),
    filter: queryGroupSchema.optional(),
    search: z.string().max(QUERY_LIMITS.search).optional(),
    sort: z
        .array(z.strictObject({ field: fieldKeySchema, desc: z.boolean().default(false) }))
        .max(QUERY_LIMITS.sort)
        .default([]),
    fields: z.array(fieldKeySchema).min(1).max(100).optional()
});

export type SubmissionExport = z.infer<typeof submissionExportSchema>;

export const historyEntrySchema = z.object({
    id: z.uuid(),
    /** insert, update, delete, or an event (`event:<type>`) */
    action: z.string(),
    at: z.string(),
    actorId: z.uuid().nullable(),
    actorName: z.string().nullable(),
    /** what changed; the answers only as "answers" (the log holds them masked) */
    changes: z.array(z.string())
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

// ---- background exports (task 0.16e) ----

export const EXPORT_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'expired'] as const;
/** Why an export failed, as a code the screens translate (forms.export.failed.<code>), with the detail beside it. */
export const EXPORT_FAILURES = ['too_many_rows', 'too_large', 'invalid_query', 'not_permitted', 'failed'] as const;
export type ExportFailure = (typeof EXPORT_FAILURES)[number];
/** How many background exports one person may have queued or running at once. */
export const MAX_PENDING_EXPORTS = 2;

/** A background export as its requester sees it: they alone may follow and download it. */
export const exportJobSchema = z.object({
    id: z.uuid(),
    formId: z.uuid(),
    format: z.enum(EXPORT_FORMATS),
    status: z.enum(EXPORT_JOB_STATUSES),
    rows: z.number().int().nullable(),
    /** why it failed, as a code to translate, and its detail (too many rows, a field no longer there) */
    errorCode: z.enum(EXPORT_FAILURES).nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    /** the file is kept until then */
    keptUntil: z.string().nullable()
});

export type ExportJob = z.infer<typeof exportJobSchema>;
