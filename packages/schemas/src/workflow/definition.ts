/**
 * A workflow definition (architecture.md §8, task 0.19a): the states a case passes through and the transitions between
 * them. The engine (`@itrms/workflow`) checks a definition before it stores a version, and runs cases on the version they
 * started with. Imports nothing internal.
 *
 * - `start`: where a case begins; `task`: a person holding `assignee.role` in the assignee unit acts; `wait`: the case
 *   waits for an event (a national platform's answer, a payment) or a timeout, taken by a system actor; `end`: done.
 * - A transition out of a task is an `action`; out of a wait, an event (`on: "event:<name>"`) or `on: "timeout"`.
 * - `reject` is an action like the others, allowed only to `rejectRoles` and only from the states it lists.
 */
import { z } from 'zod';

import { i18nTextSchema } from '../i18n';

/** A state's or an action's key: `review`, `pay_fee`. */
export const WORKFLOW_KEY = /^[a-z][a-z0-9_]{0,62}$/;
/** A definition's key: `driver-licence-new`. */
export const WORKFLOW_DEFINITION_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A role: a cross-cutting plain name (`cashier`) or a module's (`competency.officer`). */
export const WORKFLOW_ROLE = /^([a-z][a-z0-9-]*\.)?[a-z][a-z0-9_]*$/;
/** An effect a module registered (`competency.issueLicence`), with an optional argument (`documents.issue:licence-card`). */
export const WORKFLOW_EFFECT = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9_.-]*(:[a-z0-9][a-z0-9-]{0,62})?$/;
/** An event a wait state is left by: `event:national.licence.accepted`. */
export const WORKFLOW_EVENT = /^event:[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/;
/** The system actor that takes an event transition: `system:national-driver-platform`. */
export const WORKFLOW_SYSTEM_ACTOR = /^system:[a-z][a-z0-9-]{0,62}$/;
/** A step form, by key and version number: `exam-result@2`. */
export const WORKFLOW_STEP_FORM = /^([a-z0-9]+(?:-[a-z0-9]+)*)@([1-9][0-9]{0,5})$/;
/** A fact a guard reads, a dotted path into the case's facts: `payment.settled`. */
export const WORKFLOW_FACT = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,7}$/;
/** A named level of the org tree (`zone`), as `level:<key>`. */
export const WORKFLOW_LEVEL = /^level:[a-z][a-z0-9_]{0,62}$/;

export const MAX_WORKFLOW_STATES = 100;
export const MAX_WORKFLOW_TRANSITIONS = 400;
const MAX_GUARD_DEPTH = 6;

export const WORKFLOW_STATE_KINDS = ['start', 'task', 'wait', 'end'] as const;
export type WorkflowStateKind = (typeof WORKFLOW_STATE_KINDS)[number];

/**
 * Who acts on a task: the unit handling the case, its parent ("the zone approves for a town"), the region, the nearest
 * ancestor of a named level, or the service's `approval_unit` setting (one of these, resolved and frozen on the case).
 */
export const WORKFLOW_UNIT_RULES = ['handling', 'parent', 'region', '${approval_unit}'] as const;
export const workflowUnitRuleSchema = z.union([
    z.enum(WORKFLOW_UNIT_RULES),
    z.string().regex(WORKFLOW_LEVEL, 'must be handling, parent, region, ${approval_unit} or level:<key>')
]);
export type WorkflowUnitRule = z.infer<typeof workflowUnitRuleSchema>;

const key = z.string().regex(WORKFLOW_KEY, 'must be lowercase letters, digits and _ (at most 63)');
const role = z.string().regex(WORKFLOW_ROLE, 'must be a role key');

export const GUARD_OPERATORS = ['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
export type GuardOperator = (typeof GUARD_OPERATORS)[number];
const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

/** A condition on the case's facts. No regular expressions: a guard runs on the server inside the transaction. */
export type WorkflowGuard =
    | { fact: string; op: GuardOperator; value?: string | number | boolean | null | (string | number)[] }
    | { all: WorkflowGuard[] }
    | { any: WorkflowGuard[] }
    | { not: WorkflowGuard };

const depthOf = (g: unknown, depth = 1): number => {
    if (!g || typeof g !== 'object') return depth;
    const o = g as Record<string, unknown>;
    const children = [o.all, o.any]
        .flatMap((x): unknown[] => (Array.isArray(x) ? (x as unknown[]) : []))
        .concat(o.not ? [o.not] : []);
    return children.length ? Math.max(...children.map((c) => depthOf(c, depth + 1))) : depth;
};

export const workflowGuardSchema: z.ZodType<WorkflowGuard> = z
    .lazy(() =>
        z.union([
            z
                .object({
                    fact: z.string().regex(WORKFLOW_FACT, 'must be a dotted fact name'),
                    op: z.enum(GUARD_OPERATORS),
                    value: z
                        .union([scalar, z.array(z.union([z.string().max(200), z.number().finite()])).max(50)])
                        .optional()
                })
                .strict()
                .superRefine((g, ctx) => {
                    if (g.op === 'exists' ? g.value !== undefined : g.value === undefined)
                        ctx.addIssue({
                            code: 'custom',
                            path: ['value'],
                            message: g.op === 'exists' ? 'exists takes no value' : `${g.op} needs a value`
                        });
                    if ((g.op === 'in') !== Array.isArray(g.value) && g.op !== 'exists')
                        ctx.addIssue({
                            code: 'custom',
                            path: ['value'],
                            message: 'a list goes with in, and only with in'
                        });
                }),
            z.object({ all: z.array(workflowGuardSchema).min(1).max(20) }).strict(),
            z.object({ any: z.array(workflowGuardSchema).min(1).max(20) }).strict(),
            z.object({ not: workflowGuardSchema }).strict()
        ])
    )
    .superRefine((g, ctx) => {
        if (depthOf(g) > MAX_GUARD_DEPTH)
            ctx.addIssue({ code: 'custom', message: `a guard nests at most ${MAX_GUARD_DEPTH} levels` });
    });

export const workflowSlaSchema = z
    .object({
        businessHours: z.number().int().min(1).max(10_000).optional(),
        businessDays: z.number().int().min(1).max(1_000).optional()
    })
    .strict()
    .refine((s) => (s.businessHours === undefined) !== (s.businessDays === undefined), 'give business hours or days');

export const workflowStateSchema = z
    .object({
        key,
        kind: z.enum(WORKFLOW_STATE_KINDS),
        label: i18nTextSchema.optional(),
        /** task states: the role that acts and the unit it is held in */
        assignee: z.object({ role, unit: workflowUnitRuleSchema }).strict().optional(),
        /** task and wait states; the timer is 0.20's */
        sla: workflowSlaSchema.optional(),
        /** task states: the form the actor fills in to take an action (validated on the server) */
        stepForm: z.string().regex(WORKFLOW_STEP_FORM, 'must be <form-key>@<version>').optional(),
        /** task states: whoever acted on these states (or started the case: `start`) may not act here */
        separationOfDuties: z.array(key).max(20).optional()
    })
    .strict()
    .superRefine((s, ctx) => {
        const only = (field: 'assignee' | 'stepForm' | 'separationOfDuties' | 'sla', kinds: WorkflowStateKind[]) => {
            if (s[field] !== undefined && !kinds.includes(s.kind))
                ctx.addIssue({
                    code: 'custom',
                    path: [field],
                    message: `only a ${kinds.join(' or ')} state has ${field}`
                });
        };
        only('assignee', ['task']);
        only('stepForm', ['task']);
        only('separationOfDuties', ['task']);
        only('sla', ['task', 'wait']);
        if (s.kind === 'task' && !s.assignee)
            ctx.addIssue({ code: 'custom', path: ['assignee'], message: 'a task state needs an assignee' });
    });
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const workflowTransitionSchema = z
    .object({
        from: z.union([key, z.array(key).min(1).max(50)]),
        to: key,
        /** a person's action (task states) */
        action: key.optional(),
        /** an event or a timeout (wait states), taken by a system actor */
        on: z
            .union([z.literal('timeout'), z.string().regex(WORKFLOW_EVENT, 'must be timeout or event:<name>')])
            .optional(),
        /** the system actor of an event transition */
        actor: z.string().regex(WORKFLOW_SYSTEM_ACTOR, 'must be system:<adapter>').optional(),
        label: i18nTextSchema.optional(),
        guard: workflowGuardSchema.optional(),
        effects: z.array(z.string().regex(WORKFLOW_EFFECT, 'must be <module>.<effect>')).max(20).optional(),
        commentRequired: z.boolean().optional(),
        /** reject only: who may reject (anyone else may not, the step's own role included) */
        rejectRoles: z.array(role).min(1).max(20).optional()
    })
    .strict()
    .superRefine((t, ctx) => {
        if ((t.action === undefined) === (t.on === undefined))
            ctx.addIssue({
                code: 'custom',
                path: ['action'],
                message: 'a transition has an action or an on, not both'
            });
        if (t.on?.startsWith('event:') && !t.actor)
            ctx.addIssue({ code: 'custom', path: ['actor'], message: 'an event transition names its system actor' });
        if (t.actor && !t.on?.startsWith('event:'))
            ctx.addIssue({ code: 'custom', path: ['actor'], message: 'only an event transition has a system actor' });
        if ((t.action === 'reject') !== (t.rejectRoles !== undefined))
            ctx.addIssue({
                code: 'custom',
                path: ['rejectRoles'],
                message: 'reject names its rejectRoles, and only reject has them'
            });
    });
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;

export const workflowDefinitionSchema = z
    .object({
        schemaVersion: z.literal(1),
        states: z.array(workflowStateSchema).min(2).max(MAX_WORKFLOW_STATES),
        transitions: z.array(workflowTransitionSchema).min(1).max(MAX_WORKFLOW_TRANSITIONS)
    })
    .strict();
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** The `from` of a transition as a list. */
export const fromStates = (t: Pick<WorkflowTransition, 'from'>): string[] =>
    Array.isArray(t.from) ? t.from : [t.from];

/** A step form reference's parts (of a reference the schema accepted). */
export function parseStepForm(ref: string): { key: string; number: number } | null {
    const at = ref.lastIndexOf('@');
    const number = Number(ref.slice(at + 1));
    return at > 0 && Number.isInteger(number) && number > 0 ? { key: ref.slice(0, at), number } : null;
}

/** An effect reference's registered key (without its argument). */
export const effectKeyOf = (ref: string): string => ref.split(':')[0] ?? ref;
