/**
 * The stored form as a contract for the backend: `form_config` = `{ schemaVersion?, fields, runtime? }`, every field readable
 * by `storedFieldSchema` and of a type the field kit has. The API checks every saved form
 * against it with the engine's field types (`FIELD_TYPES`). Lenient where stored
 * forms are (unknown keys are kept), strict where the engine depends on it (ids, types, the runtime's data sources).
 */
import { z } from 'zod';

import { LANGUAGE_TAG } from '../i18n';
import { fieldTexts, formTextSchema } from './text';

import { SCHEMA_VERSION, storedFieldSchema } from './schema';

/** Limits of one form (the backend refuses bigger ones). */
export const MAX_FIELDS = 1000;
/** How many fields one form should have (the publish check lints above it; a constant until the unit settings of 0.21). */
export const FORM_FIELD_LIMIT = 300;
/** Test cases one form carries (versioned and hashed with it). */
export const MAX_TEST_CASES = 50;
/** A rule's formula (requiredWhen, validWhen) and how many validWhen rules one field has. */
export const MAX_RULE_EXPRESSION = 500;
export const MAX_VALID_WHEN = 10;

/**
 * One test case of a form: values a person could enter (with the language and roles they act in), and what the engine must
 * answer: valid or not, which fields fail (a string is the exact message, `true` any), and values the submission keeps.
 */
export const testCaseSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        name: z.string().min(1).max(200),
        language: z.string().regex(LANGUAGE_TAG, 'is not a language tag').optional(),
        roles: z.array(z.string().min(1).max(100)).max(20).optional(),
        values: z.record(z.string(), z.unknown()),
        expect: z.object({
            valid: z.boolean(),
            errors: z.record(z.string(), z.union([z.string(), z.literal(true)])).optional(),
            values: z.record(z.string(), z.unknown()).optional()
        })
    })
    .refine((c) => !(c.expect.valid && c.expect.errors !== undefined), {
        path: ['expect', 'errors'],
        message: 'a valid case cannot expect errors'
    });

export type FormTestCase = z.infer<typeof testCaseSchema>;

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
            textLanguage: z.string().regex(LANGUAGE_TAG, 'is not a language tag').optional(),
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
            testCases: z.array(testCaseSchema).max(MAX_TEST_CASES).optional(),
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
