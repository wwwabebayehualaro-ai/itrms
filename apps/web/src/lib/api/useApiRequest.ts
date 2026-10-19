'use client';

import { useCallback, useState } from 'react';
import { getApiErrorMessage } from './errors';

interface RunOptions {
    /** Message used when the error carries none. */
    fallback?: string;
    /** Rethrow after recording the error (default: swallow and resolve `null`). */
    rethrow?: boolean;
}

/**
 * Shared loading/error state for imperative API calls. Replaces the per-function
 * `setLoading / try / catch / setError / finally` block hand-copied in each hook.
 */
export function useApiRequest() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(
        async <T>(call: () => Promise<T>, { fallback, rethrow = false }: RunOptions = {}): Promise<T | null> => {
            setLoading(true);
            setError(null);
            try {
                return await call();
            } catch (err) {
                setError(getApiErrorMessage(err, fallback));
                if (rethrow) throw err instanceof Error ? err : new Error(getApiErrorMessage(err, fallback));
                return null;
            } finally {
                setLoading(false);
            }
        },
        []
    );

    const resetError = useCallback(() => setError(null), []);
    return { run, loading, error, resetError };
}
