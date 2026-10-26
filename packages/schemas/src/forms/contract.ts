/**
 * The stored form as a contract for the backend: `form_config` = `{ schemaVersion?, fields, runtime? }`, every field readable
 * by `storedFieldSchema` and of a type the field kit has. Exported as JSON Schema to `contracts/form-config.schema.json`
 * (`pnpm --filter @itrms/form-engine form:schema`); the backend checks every saved form against it. Lenient where stored
 * forms are (unknown keys are kept), strict where the engine depends on it (ids, types, the runtime's data sources).
 */
import { z } from 'zod';

import { fieldTexts, formTextSchema } from './text';

import { SCHEMA_VERSION, storedFieldSchema } from './schema';

/** Limits of one form (the backend refuses bigger ones). */
export const MAX_FIELDS = 1000;
/** A rule's formula (requiredWhen, validWhen) and how many validWhen rules one field has. */
export const MAX_RULE_EXPRESSION = 500;
export const MAX_VALID_WHEN = 10;

const dataSourceSchema = z
    .object({
        id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
        request: z
            .object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), url: z.string().max(2000) })
            .loose()
    })
    .loose();

export function formConfigSchema(types: string[]) {
    return z
        .object({
            schemaVersion: z.number().int().min(1).max(SCHEMA_VERSION).optional(),
            fields: z
                .array(
                    storedFieldSchema
                        .extend({
                            id: z.string().min(1).max(200),
                            type: z.enum(types as [string, ...string[]])
                        })
                        // every text a plain string or a map of language tags to strings (forms/text.ts)
                        .superRefine((field, ctx) => {
                            for (const text of fieldTexts(field)) {
                                if (text.value === undefined || text.value === null) continue;
                                const checked = formTextSchema.safeParse(text.value);
                                if (!checked.success)
                                    for (const issue of checked.error.issues)
                                        ctx.addIssue({
                                            code: 'custom',
                                            path: [...text.path.split('.'), ...issue.path.map(String)],
                                            message: issue.message
                                        });
                            }
                            const validation = field.behavior?.validation;
                            const tooLong = (path: (string | number)[]) =>
                                ctx.addIssue({
                                    code: 'custom',
                                    path: ['behavior', 'validation', ...path, 'expression'],
                                    message: `at most ${MAX_RULE_EXPRESSION} characters`
                                });
                            if ((validation?.requiredWhen?.expression.length ?? 0) > MAX_RULE_EXPRESSION)
                                tooLong(['requiredWhen']);
                            const rules = validation?.validWhen ?? [];
                            if (rules.length > MAX_VALID_WHEN)
                                ctx.addIssue({
                                    code: 'custom',
                                    path: ['behavior', 'validation', 'validWhen'],
                                    message: `at most ${MAX_VALID_WHEN} rules`
                                });
                            rules.forEach((rule, i) => {
                                if (rule.expression.length > MAX_RULE_EXPRESSION) tooLong(['validWhen', i]);
                            });
                        })
                )
                .max(MAX_FIELDS),
            runtime: z
                .object({
                    dataSources: z.array(dataSourceSchema).max(100),
                    submit: z
                        .object({
                            serverAction: z
                                .string()
                                .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
                                .optional()
                        })
                        .loose()
                        .optional()
                })
                .loose()
                .optional()
        })
        .loose()
        .meta({
            title: 'form_config',
            description:
                'A stored form: its fields (flat, linked by parentId) and its runtime (data sources, variables, submit).'
        });
}

/** The JSON Schema of `form_config` for the given field types (sorted, so the file only changes when the contract does). */
export function formConfigJsonSchema(types: string[]): string {
    const schema = z.toJSONSchema(formConfigSchema([...new Set(types)].sort()), {
        io: 'input',
        unrepresentable: 'any'
    });
    return JSON.stringify(schema, null, 2) + '\n';
}
