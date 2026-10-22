import { InvalidRequestError } from './app-error';

/** `If-Match: "3"` (or 3, W/"3"): the row version a change is based on (api-guidelines.md §3). */
export function versionFrom(header: string | undefined): number {
    const match = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header ?? '');
    if (!match)
        throw new InvalidRequestError('invalid_request', { detail: 'Send If-Match with the version you changed.' });
    return Number(match[1]);
}
