/**
 * The stored form (`form_config`) as Zod schemas. Lenient on purpose: forms saved by older builders carry more keys, and
 * every key is kept when a form is read and written back. The engine (packages/form-engine/core) reads documents with these;
 * the contract (contract.ts) adds what the backend checks on save.
 */
import { z } from 'zod';

import type { VisibilityCondition } from './conditions';

/** Version of the stored document this engine writes. Documents without a version are the original builder format (1). */
export const SCHEMA_VERSION = 2;

const conditionSchema: z.ZodType<VisibilityCondition> = z.lazy(() =>
    z
        .object({
            field: z.string().default(''),
            operator: z.string(),
            value: z.unknown().optional(),
            logic: z.enum(['and', 'or', 'xor']).optional(),
            conditions: z.array(conditionSchema).optional(),
            clientOnly: z.boolean().optional(),
            serverOnly: z.boolean().optional()
        })
        .loose()
) as unknown as z.ZodType<VisibilityCondition>;

/** One stored field. Lenient on purpose: unknown keys are kept, so reading and writing a document never loses data. */
export const storedFieldSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform(String),
        type: z.string(),
        category: z.string().optional(),
        label: z.string().optional().nullable(),
        parentId: z.union([z.string(), z.number()]).optional().nullable(),
        props: z.record(z.string(), z.unknown()).optional().nullable(),
        data: z
            .object({
                defaultProps: z.record(z.string(), z.unknown()).optional().nullable(),
                dataSource: z.object({ staticData: z.unknown().optional() }).loose().optional().nullable(),
                optionsBinding: z.object({ dataSourceId: z.string() }).loose().optional().nullable(),
                rowsBinding: z.object({ dataSourceId: z.string() }).loose().optional().nullable(),
                computed: z
                    .object({ expression: z.string(), readOnly: z.boolean().optional() })
                    .loose()
                    .optional()
                    .nullable()
            })
            .loose()
            .optional()
            .nullable(),
        behavior: z
            .object({
                validation: z
                    .object({
                        supported: z.boolean().optional(),
                        types: z.array(z.string()).optional().nullable(),
                        rules: z.record(z.string(), z.unknown()).optional().nullable(),
                        errorMessages: z.record(z.string(), z.string()).optional().nullable(),
                        remote: z
                            .object({ dataSourceId: z.string(), message: z.string().optional() })
                            .loose()
                            .optional()
                            .nullable()
                    })
                    .loose()
                    .optional()
                    .nullable(),
                visibilityConditions: z.array(conditionSchema).optional().nullable(),
                enabledConditions: z.array(conditionSchema).optional().nullable(),
                actions: z.record(z.string(), z.array(z.unknown())).optional().nullable()
            })
            .loose()
            .optional()
            .nullable(),
        layout: z
            .object({ options: z.object({ isContainer: z.boolean().optional() }).loose().optional().nullable() })
            .loose()
            .optional()
            .nullable(),
        metadata: z.object({ description: z.string().optional() }).loose().optional().nullable(),
        visibleToRoles: z.array(z.string()).optional().nullable()
    })
    .loose();

export type StoredField = z.infer<typeof storedFieldSchema>;

export const formDocumentSchema = z
    .object({
        schemaVersion: z.number().int().optional(),
        fields: z.array(z.unknown()).default([]),
        runtime: z.unknown().optional()
    })
    .loose();
