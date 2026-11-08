/**
 * Installs the request-context key where the database verifies the API's signed context (ADR-0048), as the migrate step
 * does after the migrations: the key becomes the active one, and any other stays valid for five minutes, so requests
 * signed with it just before a rotation still pass. One transaction, with an audit row naming the key's id (never the
 * key). Run as the owner role.
 */
import type { Pool } from 'pg';

import { contextKeyId } from './context-token';

/** How long a rotated-out key still verifies the requests signed with it. */
export const CONTEXT_KEY_GRACE = '5 minutes';

export async function installContextKey(pool: Pool, key: Buffer): Promise<string> {
    const kid = contextKeyId(key);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const installed = await client.query<{ fresh: boolean }>(
            `INSERT INTO kernel.context_keys (kid, key) VALUES ($1, $2)
             ON CONFLICT (kid) DO UPDATE SET retired_at = NULL
             RETURNING (xmax = 0) AS fresh`,
            [kid, key]
        );
        const retired = await client.query(
            `UPDATE kernel.context_keys SET retired_at = now() + $2::interval
              WHERE kid <> $1 AND retired_at IS NULL`,
            [kid, CONTEXT_KEY_GRACE]
        );
        await client.query(
            `INSERT INTO kernel.audit_log (id, action, event_type, diff)
             VALUES (gen_random_uuid(), 'event', 'system.context_key_installed', $1::jsonb)`,
            [JSON.stringify({ kid, fresh: installed.rows[0]?.fresh ?? false, retired: retired.rowCount ?? 0 })]
        );
        await client.query('COMMIT');
        return kid;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}
