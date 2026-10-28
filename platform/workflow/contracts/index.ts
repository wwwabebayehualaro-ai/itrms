// Public entry of @itrms/workflow (code-structure.md §4): the definitions API's DTOs (task 0.19a). The definition's own
// schema is in @itrms/schemas (workflowDefinitionSchema); the API runs the engine's checks on what it is sent.
import { i18nTextSchema, WORKFLOW_DEFINITION_KEY } from '@itrms/schemas';
import { z } from 'zod';

/** A stored definition is at most 512 KB of JSON (the table allows room for jsonb's encoding). */
export const MAX_DEFINITION_BYTES = 512 * 1024;

const utf8 = new TextEncoder();

/** How deep a definition's JSON may nest (a definition needs about 8 levels, a guard 6 more). */
export const MAX_DEFINITION_DEPTH = 32;

/** Whether `value` nests deeper than `max` levels, measured without recursion (a hostile body cannot exhaust the stack). */
export function nestsDeeperThan(value: unknown, max: number): boolean {
    const stack: [unknown, number][] = [[value, 1]];
    for (let item = stack.pop(); item; item = stack.pop()) {
        const [v, depth] = item;
        if (!v || typeof v !== 'object') continue;
        if (depth > max) return true;
        for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
    }
    return false;
}

/** The definition as sent: any object within the depth and size limits; the engine's checks say what is wrong with it. */
export const definitionInputSchema = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
    if (nestsDeeperThan(v, MAX_DEFINITION_DEPTH))
        ctx.addIssue({ code: 'custom', message: `nested deeper than ${MAX_DEFINITION_DEPTH} levels` });
    else if (utf8.encode(JSON.stringify(v)).length > MAX_DEFINITION_BYTES)
        ctx.addIssue({ code: 'custom', message: `larger than ${MAX_DEFINITION_BYTES / 1024} KB` });
});

export const workflowKeySchema = z
    .string()
    .min(2)
    .max(80)
    .regex(WORKFLOW_DEFINITION_KEY, 'lower-case letters and digits, joined by hyphens');

/** A workflow's name: Amharic and English, at most 10 languages of 200 characters. */
export const workflowNameSchema = i18nTextSchema.refine(
    (t) => Object.keys(t).length <= 10 && Object.values(t).every((v) => typeof v === 'string' && v.length <= 200),
    'at most 10 languages of 200 characters'
);

export const workflowCreateSchema = z.strictObject({
    key: workflowKeySchema,
    name: workflowNameSchema,
    definition: definitionInputSchema
});

export const workflowVersionCreateSchema = z.strictObject({ definition: definitionInputSchema });

export const workflowCheckRequestSchema = z.strictObject({ definition: definitionInputSchema });

export const workflowListQuerySchema = z.strictObject({
    q: z.string().trim().max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

/** One problem the engine found: its code (`workflow.check.<code>` in the catalogues), where, and what it says. */
export const checkProblemSchema = z.object({
    code: z.string(),
    path: z.string(),
    /** in the reader's language */
    message: z.string()
});

export const workflowCheckSchema = z.object({ ok: z.boolean(), problems: z.array(checkProblemSchema) });

const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });
const versionRefSchema = z.object({ id: z.uuid(), number: z.number().int() });

export const workflowSchema = z.object({
    id: z.uuid(),
    /** the row version, for If-Match */
    version: z.number().int(),
    key: z.string(),
    name: z.record(z.string(), z.string()),
    active: z.boolean(),
    ownerUnit: unitRefSchema,
    latestVersion: versionRefSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});

export const workflowVersionSummarySchema = z.object({
    id: z.uuid(),
    definitionId: z.uuid(),
    number: z.number().int(),
    contentHash: z.string(),
    createdAt: z.string(),
    createdBy: z.uuid().nullable()
});

export const workflowVersionSchema = workflowVersionSummarySchema.extend({
    definition: z.record(z.string(), z.unknown())
});

export type WorkflowCreate = z.infer<typeof workflowCreateSchema>;
export type WorkflowCheck = z.infer<typeof workflowCheckSchema>;
export type WorkflowOut = z.infer<typeof workflowSchema>;
export type WorkflowVersionSummary = z.infer<typeof workflowVersionSummarySchema>;
export type WorkflowVersionOut = z.infer<typeof workflowVersionSchema>;

// --- cases (task 0.19b) -------------------------------------------------------------------------------------------

/** A person's transition: the action, the step form's answers when the step has one, and a comment where one is required. */
export const transitionSchema = z.strictObject({
    action: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'an action key'),
    answers: z.record(z.string(), z.unknown()).optional(),
    comment: z.string().trim().min(1).max(2000).optional()
});

/** A member of staff as a case shows them: their id and the name the application shows. */
export const personRefSchema = z.object({ id: z.uuid(), name: z.string() });

/**
 * Where a step stands against its SLA (task 0.20b): no SLA, on time, due within `DUE_SOON_HOURS` (wall-clock hours), or
 * past its due time.
 */
export const SLA_STATES = ['none', 'on-time', 'due-soon', 'overdue'] as const;
export const DUE_SOON_HOURS = 4;

const caseTaskSchema = z.object({
    id: z.uuid(),
    state: z.string(),
    role: z.string(),
    unit: unitRefSchema,
    status: z.enum(['open', 'done', 'cancelled']),
    /** the unit the definition assigned it to, when separation of duties sent it up */
    routedFrom: unitRefSchema.nullable(),
    actedBy: z.uuid().nullable(),
    actedByName: z.string().nullable(),
    action: z.string().nullable(),
    dueAt: z.string().nullable(),
    sla: z.enum(SLA_STATES),
    /** who of the role's holders took it on (task 0.20b) */
    claimedBy: personRefSchema.nullable(),
    openedAt: z.string(),
    closedAt: z.string().nullable()
});

export const CASE_EVENT_KINDS = ['started', 'transition', 'routed', 'comment'] as const;
/** Who may read a comment: the staff working on the case (an applicant's portal comes later). */
export const COMMENT_VISIBILITIES = ['internal'] as const;

const caseEventSchema = z.object({
    id: z.uuid(),
    kind: z.enum(CASE_EVENT_KINDS),
    from: z.string().nullable(),
    to: z.string().nullable(),
    action: z.string().nullable(),
    actorUserId: z.uuid().nullable(),
    actorName: z.string().nullable(),
    systemActor: z.string().nullable(),
    /** a transition's comment, or a comment's text */
    comment: z.string().nullable(),
    /** a comment's: the people it mentions, and who may read it */
    mentions: z.array(personRefSchema),
    visibility: z.enum(COMMENT_VISIBILITIES).nullable(),
    at: z.string()
});

/**
 * A step form's answers filed on the case (task 0.20b): which step, the form version they were filled on (its document,
 * for the printed view) and the answers the caller may see (fields restricted to other roles never leave the server).
 */
const caseStepSchema = z.object({
    submissionId: z.uuid(),
    state: z.string(),
    formId: z.uuid(),
    formVersion: z.number().int(),
    form: z.unknown(),
    answers: z.record(z.string(), z.unknown()),
    /** the Sensitive fields left out of `answers` (task 0.20d): revealed on the submission's record, with a reason */
    masked: z.array(z.string()),
    submittedBy: personRefSchema.nullable(),
    at: z.string()
});

/** An action the caller may take now, as the definition describes it. */
const caseActionSchema = z.object({
    action: z.string(),
    label: z.record(z.string(), z.string()).nullable(),
    commentRequired: z.boolean(),
    /** the step's form must be filled in with it */
    needsForm: z.boolean()
});

export const caseSchema = z.object({
    id: z.uuid(),
    /** the row version, for If-Match */
    version: z.number().int(),
    number: z.number().int(),
    state: z.string(),
    closed: z.boolean(),
    handlingUnit: unitRefSchema,
    workflow: z.object({
        id: z.uuid(),
        versionId: z.uuid(),
        number: z.number().int(),
        name: z.record(z.string(), z.string())
    }),
    /** the states' labels (I18nText) by key, for the timeline */
    stateLabels: z.record(z.string(), z.record(z.string(), z.string())),
    startedBy: z.uuid(),
    startedByName: z.string().nullable(),
    /** the actions the caller may take now (before guards: a guard can still refuse one) */
    actions: z.array(z.string()),
    actionDetails: z.array(caseActionSchema),
    /** the steps the caller can see: their own unit's and those of units below it */
    tasks: z.array(caseTaskSchema),
    events: z.array(caseEventSchema),
    /** the step forms' answers, in the order they were filed */
    steps: z.array(caseStepSchema),
    /** the caller may comment on it (case:comment) */
    canComment: z.boolean(),
    createdAt: z.string(),
    closedAt: z.string().nullable()
});

export type Transition = z.infer<typeof transitionSchema>;
export type CaseOut = z.infer<typeof caseSchema>;
export type CaseStep = z.infer<typeof caseStepSchema>;
export type CaseEvent = z.infer<typeof caseEventSchema>;
export type PersonRef = z.infer<typeof personRefSchema>;
export type SlaState = (typeof SLA_STATES)[number];

// --- starting a case, the inbox, claims, comments (task 0.20b) -----------------------------------------------------

/**
 * Starting a case on a workflow's newest version, handled by the caller's unit (`case:create`, intake). A service
 * request (0.21) starts one with the configuration it resolved.
 */
export const caseStartSchema = z.strictObject({ workflowId: z.uuid() });

export const inboxQuerySchema = z.strictObject({
    /** everyone's, the caller's own claims, or the ones nobody has claimed */
    claim: z.enum(['all', 'mine', 'unclaimed']).default('all'),
    sla: z.enum(['overdue', 'due-soon']).optional(),
    state: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,62}$/, 'a state key')
        .optional(),
    /** a case's number */
    number: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    /** the previous page's `nextCursor` (its last task) */
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const inboxItemSchema = z.object({
    taskId: z.uuid(),
    caseId: z.uuid(),
    caseNumber: z.number().int(),
    workflow: z.object({ id: z.uuid(), name: z.record(z.string(), z.string()) }),
    state: z.string(),
    stateLabel: z.record(z.string(), z.string()).nullable(),
    role: z.string(),
    unit: unitRefSchema,
    routedFrom: unitRefSchema.nullable(),
    dueAt: z.string().nullable(),
    sla: z.enum(SLA_STATES),
    claimedBy: personRefSchema.nullable(),
    /** false when separation of duties keeps the caller off this step (they took an earlier one) */
    mayAct: z.boolean(),
    openedAt: z.string()
});

/** The caller's inbox: by due time (overdue first, no SLA last), then the oldest. */
export const inboxSchema = z.object({ items: z.array(inboxItemSchema), nextCursor: z.string().nullable() });

export const commentCreateSchema = z.strictObject({
    text: z.string().trim().min(1).max(2000),
    /** the people the text mentions (`@name`): each must work on the case; each is told */
    mentions: z.array(z.uuid()).max(20).default([])
});

export const casePeopleQuerySchema = z.strictObject({ q: z.string().trim().min(1).max(100).optional() });
export const casePeopleSchema = z.object({ items: z.array(personRefSchema) });

export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type Inbox = z.infer<typeof inboxSchema>;
export type CommentCreate = z.infer<typeof commentCreateSchema>;

/** The events the slice emits (code-structure.md §5.6). */
export const WORKFLOW_EVENTS = {
    'case.transitioned.v1': z.object({
        caseId: z.uuid(),
        from: z.string(),
        to: z.string(),
        action: z.string(),
        closed: z.boolean()
    }),
    /** a step's SLA timer (available when it is due) */
    'case-task.due.v1': z.object({ taskId: z.uuid(), caseId: z.uuid() }),
    /** a wait's SLA timer: its timeout (available when it is due) */
    'case.wait-due.v1': z.object({ caseId: z.uuid(), state: z.string() }),
    /** a comment: the worker tells the people it mentions (task 0.20b) */
    'case.commented.v1': z.object({ caseId: z.uuid(), eventId: z.uuid(), mentions: z.array(z.uuid()) })
};
