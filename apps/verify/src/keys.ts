/**
 * What the phone keeps for its offline check (ADR-0046): the published public keys and the names of the kinds of document, fetched
 * whenever there is a connection. Nothing private, in plain browser storage. If storage is refused (a private window), they last for
 * the page.
 */
import { PUBLIC_KEY_TEXT, type PublishedKey } from '@itrms/documents/contracts/verification-check';
import type { VerificationKeysOut } from '@itrms/documents/contracts';

export type DocumentName = VerificationKeysOut['documents'][number];

export interface KnownKeys {
    keys: PublishedKey[];
    documents: DocumentName[];
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
        PUBLIC_KEY_TEXT.test(k.publicKey) &&
        (k.retiredOn === null || (typeof k.retiredOn === 'string' && DAY.test(k.retiredOn)))
    );
};

const isDocument = (value: unknown): value is DocumentName => {
    if (typeof value !== 'object' || value === null) return false;
    const d = value as { key?: unknown; name?: unknown };
    return (
        typeof d.key === 'string' &&
        typeof d.name === 'object' &&
        d.name !== null &&
        Object.values(d.name).every((text) => typeof text === 'string')
    );
};

/** No keys are no use, and never replace keys a phone has: an installation that has signed nothing yet, or a restored one. */
const areKeys = (value: unknown): value is PublishedKey[] =>
    Array.isArray(value) && value.length > 0 && value.every(isKey);
const areDocuments = (value: unknown): value is DocumentName[] => Array.isArray(value) && value.every(isDocument);

/** What this phone already has. */
export const storedKeys = (): KnownKeys | null => {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        const known = saved as Partial<KnownKeys> | null;
        return known &&
            areKeys(known.keys) &&
            areDocuments(known.documents) &&
            typeof known.updatedAt === 'string' &&
            !Number.isNaN(Date.parse(known.updatedAt))
            ? { keys: known.keys, documents: known.documents, updatedAt: known.updatedAt }
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
            // a document signed by a key this minute's list lacks is exactly when this is asked
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { keys?: unknown; documents?: unknown };
        if (!areKeys(body.keys) || !areDocuments(body.documents)) return null;
        const known: KnownKeys = { keys: body.keys, documents: body.documents, updatedAt: now.toISOString() };
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
