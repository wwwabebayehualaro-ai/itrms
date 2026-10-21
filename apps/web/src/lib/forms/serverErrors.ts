import { problemFieldErrors } from '@itrms/schemas';
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
 * problem+json `errors: [{ field: "a.b", message }]`; fields the form does not know (`known`) are folded into the form
 * message so nothing is silently dropped.
 */
export function serverFormErrors(err: unknown, known?: Iterable<string>): ServerFormErrors {
    const split = isApiError(err) ? problemFieldErrors(err.response?.data, known) : undefined;
    if (split) return { fields: split.fields, form: split.rest.length ? split.rest.join('; ') : undefined };
    return { fields: {}, form: getApiErrorMessage(err) };
}
