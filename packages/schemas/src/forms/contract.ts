/**
 * The stored form as a contract for the backend: `form_config` = `{ schemaVersion?, fields, runtime? }`, every field readable
 * by `storedFieldSchema` and of a type the field kit has. Exported as JSON Schema to `contracts/form-config.schema.json`
 * (`pnpm --filter @itrms/form-engine form:schema`); the backend checks every saved form against it. Lenient where stored
 * forms are (unknown keys are kept), strict where the engine depends on it (ids, types, the runtime's data sources).
 */
import { z } from 'zod';

import { SCHEMA_VERSION, storedFieldSchema } from './schema';

/** Limits of one form (the backend refuses bigger ones). */
export const MAX_FIELDS = 1000;

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
                    storedFieldSchema.extend({
                        id: z.string().min(1).max(200),
                        type: z.enum(types as [string, ...string[]])
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
