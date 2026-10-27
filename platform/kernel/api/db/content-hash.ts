/**
 * The content hash of a stored document (form and workflow versions): sha-256 of its canonical JSON, so the same content
 * always names the same version whatever order its keys were written in (jsonb does not keep key order).
 */
import { createHash } from 'node:crypto';

/** JSON with every object's keys sorted. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              )
            : v
    );
}

export const contentHash = (document: unknown): string =>
    createHash('sha256').update(canonicalJson(document)).digest('hex');
