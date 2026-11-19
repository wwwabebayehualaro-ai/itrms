/**
 * Counters on enable (task 1.4b4, ADR-0056), on a real PostgreSQL 16 through the API: an office created with a type gets the
 * counters its services and its capabilities need, an office given a service later gets that service's, in the same
 * transaction and on record; a counter it has is never touched. And the grant behind it: request code may insert a fresh
 * counter in its subtree, never its last value or period, never another office's.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { createDatabase, type Database } from '@itrms/kernel/db';
import { efy } from '@itrms/ethiopian-calendar';
import { nextNumber, setUpCounter } from '@itrms/kernel/numbering';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import type { OrgUnit } from '@itrms/kernel/org';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

// the seeded zone administrator of Wolaita (service settings) and the bureau's (who creates an office)
const ZONE_ADMIN = '0199f0a0-d000-7000-8000-000000000102';
const BUREAU = '0199f0a0-d000-7000-8000-000000000001';

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let zone: OrgUnit;
let areka: OrgUnit;
let damot: OrgUnit;
let boditi: OrgUnit;
let admin: As;
let bureau: As;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg, []);
    app = createDatabase(pg.url('app'), { auditKey: randomBytes(32).toString('hex'), contextKey: TEST_CONTEXT_KEY });
    zone = await api.unit('SER', 'WOL');
    areka = await api.unit('SER', 'WOL-AREKA');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    boditi = await api.unit('SER', 'WOL-BODITI');
    admin = { sub: ZONE_ADMIN, unit: zone };
    bureau = { sub: BUREAU, unit: await api.unit('SER', 'SER') };
}, 300_000);

afterAll(async () => {
    await app?.close();
    await api?.close();
    await pg?.stop();
});

const countersOf = async (unitId: string) =>
    (
        await api.owner.query<{ key: string; pattern: string; last_value: string; period: string }>(
            `select key, pattern, last_value::text, period from kernel.number_counters where unit_id = $1 order by key`,
            [unitId]
        )
    ).rows;

const setUpEvents = async (unitId: string) =>
    (
        await api.owner.query<{ key: string; because: string; actor_id: string | null; request_id: string | null }>(
            `select diff->>'key' as key, diff->>'because' as because, actor_id, request_id from kernel.audit_log
              where event_type = 'numbering.counter_set_up' and diff->>'unitId' = $1 order by diff->>'key'`,
            [unitId]
        )
    ).rows;

describe('an office created with a type', () => {
    it('gets the counters of its services and its capabilities, fresh and on record', async () => {
        const [type] = (
            await api.owner.query<{ id: string }>(
                `select id from kernel.unit_types where key = 'town_unit_f1' and region_id = $1`,
                [zone.regionId]
            )
        ).rows;
        const code = `WOL-CNT-${randomUUID().slice(0, 6)}`;
        const created = await api.call('POST', '/api/v1/org-units', bureau, {
            parentId: zone.id,
            kind: 'town_admin',
            levelKey: 'town',
            code,
            name: { am: 'á‹¨áˆ™áŠ¨áˆ« áŠ¨á‰°áˆ›', en: 'Trial town' },
            category: 'f1',
            unitTypeId: type?.id
        });
        expect(created.statusCode, created.body).toBe(201);
        const id = created.json<{ id: string }>().id;
        // DVC-01 and DVC-13 the certificate, DVC-13 the letters, DVC-14 the transfer document, DVC-02 the temporary bolo, DVC-03
        // the licence; it collects cash
        expect(await countersOf(id)).toEqual([
            { key: 'competency.licence', pattern: '{unit}/DL/{seq:06}', last_value: '0', period: '' },
            { key: 'competency.temporary-bolo', pattern: '{unit}/TB/{seq:05}', last_value: '0', period: '' },
            { key: 'competency.transfer-document', pattern: '{unit}/VT/{seq:05}/{efy}', last_value: '0', period: '' },
            { key: 'competency.transfer-letter', pattern: '{unit}/OT/{seq:05}/{efy}', last_value: '0', period: '' },
            { key: 'fees.receipt', pattern: '{unit}/{seq:06}/{efy}', last_value: '0', period: '' },
            { key: 'fees.remittance', pattern: '{unit}/RM/{seq:05}/{efy}', last_value: '0', period: '' },
            { key: 'vehicles.registration-certificate', pattern: '{unit}/RC/{seq:06}', last_value: '0', period: '' }
        ]);
        const events = await setUpEvents(id);
        expect(events).toHaveLength(7);
        for (const e of events) {
            expect(e.because).toBe('unit_created');
            expect(e.actor_id).not.toBeNull();
            expect(e.request_id).toBe(created.headers['x-request-id']);
        }
        // a cash office: its first receipt number is its own, from 1 in the fiscal year
        const receipt = await api.installer.scoped({}, (tx) => nextNumber(tx, 'fees.receipt', id));
        expect(receipt.number).toMatch(new RegExp(`^${code}/000001/[0-9]{4}$`));
        // a create refused (the same code again) makes no counter
        const total = async () =>
            (await api.owner.query<{ n: number }>('select count(*)::int as n from kernel.number_counters')).rows[0]?.n;
        const before = await total();
        const again = await api.call('POST', '/api/v1/org-units', bureau, {
            parentId: zone.id,
            kind: 'town_admin',
            levelKey: 'town',
            code,
            name: { am: 'á‹¨áˆ™áŠ¨áˆ« áŠ¨á‰°áˆ›', en: 'Trial town' },
            category: 'f1',
            unitTypeId: type?.id
        });
        expect(again.statusCode).toBe(409);
        expect(await total()).toBe(before);
    }, 120_000);
});

describe('an office given a service later', () => {
    it('gets what the service numbers from, once, and can number its first letter', async () => {
        const url = `/api/v1/org-units/${areka.id}/services/DVC-13`;
        const given = await api.call(
            'PUT',
            url,
            admin,
            { enabled: true, reason: 'transfers handled here' },
            { 'if-match': '"0"' }
        );
        expect(given.statusCode, given.body).toBe(200);
        expect((await countersOf(areka.id)).map((c) => c.key)).toEqual([
            'competency.transfer-letter',
            'vehicles.registration-certificate'
        ]);
        expect((await setUpEvents(areka.id)).map((e) => e.because)).toEqual([
            'service_enabled:DVC-13',
            'service_enabled:DVC-13'
        ]);
        // given again and reset: nothing new, nothing taken away
        const off = await api.call('PUT', url, admin, { enabled: false, reason: 'paused' }, { 'if-match': '"1"' });
        expect(off.statusCode, off.body).toBe(200);
        const on = await api.call('PUT', url, admin, { enabled: true, reason: 'resumed' }, { 'if-match': '"2"' });
        expect(on.statusCode, on.body).toBe(200);
        const reset = await api.call('DELETE', url, admin, undefined, { 'if-match': '"3"' });
        expect(reset.statusCode, reset.body).toBe(200);
        expect(await setUpEvents(areka.id)).toHaveLength(2);
        expect(await countersOf(areka.id)).toHaveLength(2);
        // the filing's check passes, and the first letter is the office's first
        const first = await api.installer.scoped({}, (tx) => nextNumber(tx, 'competency.transfer-letter', areka.id));
        expect(first.number).toMatch(/^WOL-AREKA\/OT\/00001\/\d{4}$/);
    }, 120_000);

    it('leaves a counter in use as it is', async () => {
        await api.owner.query(
            `insert into kernel.number_counters (id, region_id, unit_id, key, pattern, last_value)
             values (gen_random_uuid(), $1, $2, 'competency.licence', '{unit}/DL/{seq:06}', 41)`,
            [damot.regionId, damot.id]
        );
        const given = await api.call(
            'PUT',
            `/api/v1/org-units/${damot.id}/services/DVC-03`,
            admin,
            { enabled: true, reason: 'licences here' },
            { 'if-match': '"0"' }
        );
        expect(given.statusCode, given.body).toBe(200);
        expect((await countersOf(damot.id)).find((c) => c.key === 'competency.licence')?.last_value).toBe('41');
        expect((await setUpEvents(damot.id)).map((e) => e.key)).not.toContain('competency.licence');
    }, 120_000);
});

describe('a register taken over at an office given the service', () => {
    it('continues from the paper registerâ€™s start in its year, the counter made at 0 not yet used', async () => {
        const given = await api.call(
            'PUT',
            `/api/v1/org-units/${damot.id}/services/DVC-13`,
            admin,
            { enabled: true, reason: 'transfers here' },
            { 'if-match': '"0"' }
        );
        expect(given.statusCode, given.body).toBe(200);
        const thisYear = efy(new Date());
        // the paper letters of last year ran to 500: this year starts again at 1
        await api.installer.scoped({}, (tx) =>
            setUpCounter(tx, {
                key: 'competency.transfer-letter',
                unitId: damot.id,
                regionId: damot.regionId,
                pattern: '{unit}/OT/{seq:05}/{efy}',
                startAfter: 500n,
                startYear: thisYear - 1
            })
        );
        expect((await countersOf(damot.id)).find((c) => c.key === 'competency.transfer-letter')).toMatchObject({
            last_value: '500',
            period: String(thisYear - 1)
        });
        const first = await api.installer.scoped({}, (tx) => nextNumber(tx, 'competency.transfer-letter', damot.id));
        expect(first.number).toBe(`WOL-DAMOT-GALE/OT/00001/${thisYear}`);
    }, 120_000);
});

describe('the grant behind it (0085)', () => {
    const key = () => `test.counter-${randomUUID().slice(0, 8)}`;
    const asZone = (statement: ReturnType<typeof sql>) => app.scoped(contextFor(zone), (tx) => tx.execute(statement));

    it('lets request code insert a fresh counter in its subtree, and nothing more', async () => {
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern)
                       values (${randomUUID()}, ${boditi.regionId}, ${boditi.id}, ${key()}, '{unit}/{seq}')`)
        ).resolves.toBeDefined();
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern, last_value)
                       values (${randomUUID()}, ${boditi.regionId}, ${boditi.id}, ${key()}, '{unit}/{seq}', 5)`)
        ).rejects.toMatchObject({ cause: { code: '42501' } });
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern, period)
                       values (${randomUUID()}, ${boditi.regionId}, ${boditi.id}, ${key()}, '{unit}/{seq}', '2019')`)
        ).rejects.toMatchObject({ cause: { code: '42501' } });
        // a pattern that does not name its own unit first, even in the subtree (0085's trigger)
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern)
                       values (${randomUUID()}, ${boditi.regionId}, ${boditi.id}, ${key()}, 'WOL-AREKA/{seq}')`)
        ).rejects.toMatchObject({ cause: { code: '23514' } });
        // the region's root is above the zone: visible to it, outside its subtree (the class T policy)
        const region = await api.unit('SER', 'SER');
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern)
                       values (${randomUUID()}, ${region.regionId}, ${region.id}, ${key()}, '{unit}/{seq}')`)
        ).rejects.toMatchObject({ cause: { code: '42501' } });
        // another region's office is not even visible to the trigger that sets the row's path
        const other = await api.unit('TRX', 'TRX-W1');
        await expect(
            asZone(sql`insert into kernel.number_counters (id, region_id, unit_id, key, pattern)
                       values (${randomUUID()}, ${other.regionId}, ${other.id}, ${key()}, '{unit}/{seq}')`)
        ).rejects.toMatchObject({ cause: { code: '23503' } });
    }, 120_000);
});
