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
