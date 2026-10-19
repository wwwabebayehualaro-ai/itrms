import { isApiError } from '../api/http';
import { getApiErrorMessage } from '../api/errors';

export interface ServerFormErrors {
    /** Message for the form as a whole (no field matched, or a non-validation failure). */
    form?: string;
    /** Field name (dotted path as the form uses it) -> message. */
    fields: Record<string, string>;
}

/**
 * Split an API failure into per-field messages and a form message. The backend answers validation failures with
 * problem+json `errors: [{ field: "a.b", message }]` (see Backend/app/foundation/errors.py); fields the form does not know
 * (`known`) are folded into the form message so nothing is silently dropped.
 */
export function serverFormErrors(err: unknown, known?: Iterable<string>): ServerFormErrors {
    const knownSet = known ? new Set(known) : null;
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    const body: any = isApiError(err) ? err.response?.data : undefined;
    if (Array.isArray(body?.errors) && body.errors.length) {
        for (const e of body.errors as { field?: string; message?: string }[]) {
            const message = e.message || 'Invalid value';
            if (e.field && (!knownSet || knownSet.has(e.field)) && !fields[e.field]) fields[e.field] = message;
            else rest.push(e.field ? `${e.field}: ${message}` : message);
        }
        return { fields, form: rest.length ? rest.join('; ') : undefined };
    }
    return { fields, form: getApiErrorMessage(err) };
}
