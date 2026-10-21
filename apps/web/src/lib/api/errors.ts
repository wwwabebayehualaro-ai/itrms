import { problemMessage } from '@itrms/schemas';
import { isApiError } from './http';

/**
 * Single place that turns anything thrown by an API call into a user-facing message. The error body's own message comes
 * first (problem+json `errors[]` and `detail`, the legacy `{ error }`, FastAPI's `detail`, `message`: @itrms/schemas).
 */
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
    if (isApiError(err)) {
        const message = problemMessage(err.response?.data);
        if (message) return message;
        if (err.code === 'ECONNABORTED') return 'The request timed out';
        if (!err.response) return 'Cannot reach the server';
        return err.message || fallback;
    }
    if (err instanceof Error && err.message) return err.message;
    return fallback;
}

// Errors the platform has already shown to the user (mutation error toast). Callers that add their own
// notification (e.g. a form's submit handler) check this to avoid telling the user twice.
const reported = new WeakSet<object>();
export const markReported = (error: unknown) => {
    if (error && typeof error === 'object') reported.add(error);
};
export const isReported = (error: unknown) => !!error && typeof error === 'object' && reported.has(error);
