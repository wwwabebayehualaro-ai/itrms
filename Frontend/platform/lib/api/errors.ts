import { isAxiosError } from 'axios';

/**
 * Single place that turns anything thrown by an API call into a user-facing message.
 * Understands this backend's `{ error }` envelope, FastAPI `detail` (string or validation list) and `message`.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
    if (isAxiosError(err)) {
        const body: any = err.response?.data;
        const detail = body?.detail;
        // Platform problem+json: `detail` is the summary, `errors[]` the per-field reasons.
        if (Array.isArray(body?.errors) && body.errors.length) {
            return body.errors.map((e: any) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ');
        }
        if (typeof body?.error === 'string' && body.error) return body.error;
        if (typeof detail === 'string' && detail) return detail;
        if (Array.isArray(detail) && detail.length) return detail.map((d) => d?.msg ?? String(d)).join('; ');
        if (typeof body?.message === 'string' && body.message) return body.message;
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
