/**
 * Error bodies of the API: RFC 9457 problem+json (`detail`, per-field `errors[]`), plus the older shapes the legacy backend
 * still sends (`{ error }`, FastAPI's `detail` as a string or a validation list, `message`). Every client reads them here.
 */
import { z } from 'zod';

export const problemSchema = z
    .object({
        type: z.string(),
        title: z.string(),
        status: z.number(),
        code: z.string(),
        detail: z.union([z.string(), z.array(z.unknown())]),
        errors: z.array(z.object({ field: z.string().optional(), message: z.string().optional() }).loose()),
        error: z.string(),
        message: z.string()
    })
    .partial()
    .loose();

export type Problem = z.infer<typeof problemSchema>;

/** Each key on its own: one malformed key (a numeric `detail`) must not hide the others. */
const read = (body: unknown): Problem | undefined => {
    if (!body || typeof body !== 'object') return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(problemSchema.shape)) {
        const value = schema.safeParse((body as Record<string, unknown>)[key]);
        if (value.success && value.data !== undefined) out[key] = value.data;
    }
    return out;
};

const listMessage = (item: unknown) =>
    item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string'
        ? (item as { msg: string }).msg
        : String(item);

/** The message an error body carries for a person, or undefined when it carries none. */
export function problemMessage(body: unknown): string | undefined {
    const p = read(body);
    if (!p) return undefined;
    if (p.errors?.length) return p.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ');
    if (p.error) return p.error;
    if (typeof p.detail === 'string' && p.detail) return p.detail;
    if (Array.isArray(p.detail) && p.detail.length) return p.detail.map(listMessage).join('; ');
    if (p.message) return p.message;
    return undefined;
}

export interface ProblemFieldErrors {
    /** Field name (dotted path as the form uses it) → message. */
    fields: Record<string, string>;
    /** Messages for no known field, as "field: message" or the message alone. */
    rest: string[];
}

/**
 * The per-field reasons of a validation failure (`errors[]`), or undefined when the body has none. Fields outside `known`
 * go to `rest`, so nothing is silently dropped.
 */
export function problemFieldErrors(body: unknown, known?: Iterable<string>): ProblemFieldErrors | undefined {
    const errors = read(body)?.errors;
    if (!errors?.length) return undefined;
    const knownSet = known ? new Set(known) : null;
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const e of errors) {
        const message = e.message || 'Invalid value';
        if (e.field && (!knownSet || knownSet.has(e.field)) && !fields[e.field]) fields[e.field] = message;
        else rest.push(e.field ? `${e.field}: ${message}` : message);
    }
    return { fields, rest };
}
