// The problem+json body every failed request answers (api-guidelines.md §4), as a Zod schema for the OpenAPI document.
import { z } from 'zod';

export const problemSchema = z
    .object({
        type: z.string().meta({ description: 'urn:itrms:problem:<code>' }),
        title: z.string().meta({ description: "The problem in the person's language" }),
        status: z.number().int(),
        code: z.string().meta({ description: 'Stable snake_case code (api-guidelines.md §4)' }),
        detail: z.string().optional(),
        errors: z
            .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
            .optional()
            .meta({ description: 'One entry per refused value' }),
        traceId: z.string().optional().meta({ description: 'The request id, to quote to support' })
    })
    .meta({ title: 'Problem' });
