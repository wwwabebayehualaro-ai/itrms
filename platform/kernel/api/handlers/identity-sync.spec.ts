import { describe, expect, it } from 'vitest';

import type { SystemDatabase, SystemUse } from '../db/system';
import type { Tx } from '../db/types';
import type { IdentityAdmin } from '../iam/identity-admin';
import { identitySyncHandlers } from './identity-sync';

/** A system pool whose transactions return an empty snapshot, recording each use. */
function fakeSystem() {
    const uses: { reason: string; use?: SystemUse }[] = [];
    const empty = { execute: () => Promise.resolve({ rows: [] }) } as unknown as Tx;
    const system: SystemDatabase = {
        systemContext: (reason, fn, use) => {
            uses.push({ reason, use });
            return fn(empty);
        },
        close: () => Promise.resolve()
    };
    return { system, uses };
}

describe('the identity sync handler', () => {
    it('coalesces events: one sync at a time, the events that wait share the next one, each run audited with them', async () => {
        const { system, uses } = fakeSystem();
        let release: () => void = () => undefined;
        let runs = 0;
        const admin: IdentityAdmin = {
            syncUnits: () => {
                runs++;
                // the first run is slow: the other events arrive meanwhile
                return runs === 1
                    ? new Promise((resolve) => (release = () => resolve({ created: 0, updated: 0 })))
                    : Promise.resolve({ created: 0, updated: 0 });
            },
            syncMemberships: () => Promise.resolve()
        };
        const handle = identitySyncHandlers(system, admin)['org-unit.changed.v1'];
        if (!handle) throw new Error('no handler');
        const job = (eventId: string) => handle({ eventId, type: 'org-unit.changed.v1', payload: {} });

        const first = job('e1');
        await new Promise((r) => setTimeout(r, 10));
        const waiting = [job('e2'), job('e3'), job('e4')];
        release();
        await Promise.all([first, ...waiting]);

        expect(runs).toBe(2);
        expect(uses.map((u) => [u.reason, u.use?.recurring ?? false, u.use?.detail])).toEqual([
            ['identity.sync', false, { events: ['e1'] }],
            ['identity.sync', false, { events: ['e2', 'e3', 'e4'] }]
        ]);
    });
});
