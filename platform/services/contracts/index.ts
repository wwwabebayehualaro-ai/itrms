// Public entry of @itrms/services (code-structure.md §4): the shapes of the service catalogue, its versions and the
// units' overrides (architecture.md §6.2, §7; task 0.21b).
import { i18nTextSchema, workflowSlaSchema, workflowUnitRuleSchema, WORKFLOW_KEY } from '@itrms/schemas';
import { z } from 'zod';

/** A service code of the catalogue: DVC-03, PT-12. */
export const SERVICE_CODE = /^[A-Z]{2,5}-\d{2}$/;
export const serviceCodeSchema = z.string().regex(SERVICE_CODE, 'is not a service code');

/** One service of the catalogue as the seed brings it (platform/services/seed/catalogue.yaml). */
export const catalogueEntrySchema = z.strictObject({
    code: serviceCodeSchema,
    /** the work process (1–10, architecture.md §3) */
    process: z.number().int().min(1).max(10),
    /** the module that serves it */
    module: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: i18nTextSchema
});
export const catalogueSchema = z.strictObject({ services: z.array(catalogueEntrySchema).min(1) });
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;

/**
 * The keys a service's configuration holds, by family (`sla.<state>`, `help.<field>`): an SLA per workflow state, the unit
 * a parent-unit step goes to, a help text per form field, the documents' header line. A version gives their defaults; a
 * unit below changes only those its override policy allows at its level.
 */
export const OVERRIDE_FAMILIES = ['sla', 'approval_unit', 'help', 'templateHeader'] as const;
export type OverrideFamily = (typeof OVERRIDE_FAMILIES)[number];

/** Where a unit's value may replace the version's: the region's root, or a unit below it (its value holds in its subtree). */
export const OVERRIDE_LEVELS = ['region', 'unit'] as const;
export type OverrideLevel = (typeof OVERRIDE_LEVELS)[number];

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const familyOf = (key: string): string => key.split('.')[0] ?? key;

/** A configuration key: its family, and for `sla` a state's key, for `help` a field's key. */
export const configKeySchema = z.string().refine((key) => {
    const [family, part, extra] = key.split('.');
    if (extra !== undefined) return false;
    if (family === 'sla') return part !== undefined && WORKFLOW_KEY.test(part);
    if (family === 'help') return part !== undefined && FIELD_KEY.test(part);
    return (family === 'approval_unit' || family === 'templateHeader') && part === undefined;
}, 'is not a configuration key (sla.<state>, help.<field>, approval_unit, templateHeader)');

/** The value schema of a key, by its family. */
export const configValueSchemas: Record<OverrideFamily, z.ZodType> = {
    sla: workflowSlaSchema,
    approval_unit: workflowUnitRuleSchema.refine((r) => r !== '${approval_unit}', 'names a unit rule'),
    help: i18nTextSchema,
    templateHeader: i18nTextSchema
};

export const configFamily = (key: string): OverrideFamily | undefined => {
    const family = familyOf(key);
    return (OVERRIDE_FAMILIES as readonly string[]).includes(family) ? (family as OverrideFamily) : undefined;
};

/** Configuration values (a version's defaults, a unit's override): keys checked, each value against its family. */
export const configValuesSchema = z
    .record(configKeySchema, z.unknown())
    .superRefine((values, ctx) => {
        for (const [key, value] of Object.entries(values)) {
            const family = configFamily(key);
            if (!family) continue;
            const parsed = configValueSchemas[family].safeParse(value);
            if (!parsed.success)
                for (const issue of parsed.error.issues)
                    ctx.addIssue({ code: 'custom', path: [key, ...issue.path], message: issue.message });
        }
    })
    .refine((v) => Object.keys(v).length <= 500, 'too many keys');
export type ConfigValues = z.infer<typeof configValuesSchema>;

/** Which families a unit below may change, and at which levels (none listed: the bureau's value holds everywhere). */
export const overridePolicySchema = z
    .partialRecord(z.enum(OVERRIDE_FAMILIES), z.array(z.enum(OVERRIDE_LEVELS)).max(OVERRIDE_LEVELS.length))
    .default({});
export type OverridePolicy = z.infer<typeof overridePolicySchema>;

/** What a bureau publishes: the form and workflow versions, the defaults, the policy, from when it holds. */
export const serviceVersionInputSchema = z.strictObject({
    /** a published form version (none: a service without a request form) */
    formVersionId: z.uuid().nullable().default(null),
    workflowVersionId: z.uuid(),
    defaults: configValuesSchema.default({}),
    overridePolicy: overridePolicySchema,
    /** an Ethiopian-calendar date entered, stored Gregorian (YYYY-MM-DD); today when left out */
    effectiveFrom: z.iso.date().optional(),
    note: z.string().trim().max(500).optional()
});
export type ServiceVersionInput = z.infer<typeof serviceVersionInputSchema>;

/** A unit's override of a service: the values it sets (all of them: a PUT replaces the unit's whole override). */
export const serviceOverrideInputSchema = z.strictObject({
    values: configValuesSchema,
    reason: z.string().trim().min(3).max(500)
});

/** A request for a service at the counter: the case starts at the person's unit on the service's frozen configuration. */
export const serviceRequestSchema = z.strictObject({ serviceCode: serviceCodeSchema });

/** A problem a new version finds in an override below it (shown to the bureau, the override is kept). */
export interface OverrideConflict {
    unitId: string;
    unitName: Record<string, string>;
    key: string;
    problem: 'not_allowed' | 'unknown_state' | 'unknown_field' | 'invalid_value';
}
