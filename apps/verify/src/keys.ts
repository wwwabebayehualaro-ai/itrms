/**
 * The published public keys on this phone (ADR-0046): fetched whenever there is a connection and kept for when there isn't. Only
 * public keys and a date are kept, in plain browser storage. If storage is refused (a private window), the keys last for the page.
 */
import type { PublishedKey } from '@itrms/documents/contracts/verification-check';

export interface KnownKeys {
    keys: PublishedKey[];
    /** when they were last fetched, as an ISO instant */
    updatedAt: string;
}

const STORAGE_KEY = 'itrms.verify.keys.v1';
const TIMEOUT_MS = 20_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isKey = (value: unknown): value is PublishedKey => {
    if (typeof value !== 'object' || value === null) return false;
    const k = value as Record<string, unknown>;
    return (
        typeof k.keyId === 'string' &&
        typeof k.publicKey === 'string' &&
        (k.retiredOn === null || (typeof k.retiredOn === 'string' && DAY.test(k.retiredOn)))
    );
};

const areKeys = (value: unknown): value is PublishedKey[] => Array.isArray(value) && value.every(isKey);

/** What this phone already has. */
export const storedKeys = (): KnownKeys | null => {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        const known = saved as Partial<KnownKeys> | null;
        return known && areKeys(known.keys) && typeof known.updatedAt === 'string'
            ? { keys: known.keys, updatedAt: known.updatedAt }
            : null;
    } catch {
        return null;
    }
};

/** Ask the API. No answer, or one that isn't a key list, leaves what is there: nothing unproven replaces a key. */
export async function refreshKeys(fetcher: typeof fetch = fetch, now = new Date()): Promise<KnownKeys | null> {
    try {
        const response = await fetcher('/v1/public/verification-keys', {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { keys?: unknown };
        if (!areKeys(body.keys)) return null;
        const known: KnownKeys = { keys: body.keys, updatedAt: now.toISOString() };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(known));
        } catch {
            // private window: they last for this page
        }
        return known;
    } catch {
        return null;
    }
}
