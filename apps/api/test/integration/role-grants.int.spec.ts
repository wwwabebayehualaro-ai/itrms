/**
 * Configurable role grants (ADR-0065, task 1.6b2) on a real PostgreSQL 16 with the Wolaita seeds: the competency module's grant
 * gives the intake desk (`records_officer`) the licence register where `competency.intake_reads_licences` is on (the default). A
 * region that turns it off takes it away, a unit type may give it back to its offices, and an office cannot set it for itself. A
 * role without the grant (the cashier) never reads the register. The demo's own people at Boditi; nothing is written but settings.
 */
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureau: '0199f0a0-d000-7000-8000-000000000001',
    records: '0199f0a0-d000-7000-8000-000000000302',
    cashier: '0199f0a0-d000-7000-8000-000000000303'
};
const KEY = 'competency.intake_reads_licences';

let pg: TestPostgres;
let api: TestApi;
let region: OrgUnit;
let boditi: OrgUnit;
const as = {} as Record<keyof typeof SUB, As>;

const register = (who: As) => api.call('GET', '/api/v1/competency/licences', who);
const workspace = async (who: As) =>
    (await api.call('GET', '/api/v1/me/workspace', who)).json<{ permissions: string[]; menu: unknown }>();

/** A value the bureau sets at a level, through the settings screen's own path (sensitive: a fresh second factor). */
async function setAt(url: string, value: boolean): Promise<void> {
    const res = await api.call('PUT', url, as.bureau, { value }, { 'if-match': '"0"' });
    expect(res.statusCode, res.body).toBeLessThan(300);
}
const regionUrl = () => `/api/v1/org-units/${region.id}/settings/${KEY}`;
const typeUrl = () => `/api/v1/unit-types/${boditi.unitTypeId ?? ''}/settings/${KEY}`;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg);
    region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    as.bureau = { sub: SUB.bureau, unit: region };
    as.records = { sub: SUB.records, unit: boditi };
    as.cashier = { sub: SUB.cashier, unit: boditi };
}, 240_000);

afterEach(async () => {
    await api.owner.query('delete from kernel.settings_values where key = $1', [KEY]);
});

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('the intake desk and the licence register (a role grant)', () => {
    it('reads it by default, with the menu entry; the cashier, who has no grant, never does', async () => {
        expect((await register(as.records)).statusCode).toBe(200);
        const desk = await workspace(as.records);
        expect(desk.permissions).toContain('licence:read');
        expect(JSON.stringify(desk.menu)).toContain('competency.licences');
        expect((await register(as.cashier)).statusCode).toBe(403);
        expect((await workspace(as.cashier)).permissions).not.toContain('licence:read');
    }, 60_000);

    it('loses it where the region turns the setting off, and gets it back where a unit type turns it on', async () => {
        await setAt(regionUrl(), false);
        expect((await register(as.records)).statusCode).toBe(403);
        expect((await workspace(as.records)).permissions).not.toContain('licence:read');

        // the unit type is nearer the office than the region: its value wins for the offices of that type
        await setAt(typeUrl(), true);
        expect((await register(as.records)).statusCode).toBe(200);
    }, 60_000);

    it('is never set by one office for itself, and a change needs a fresh second factor', async () => {
        const own = await api.call(
            'PUT',
            `/api/v1/org-units/${boditi.id}/settings/${KEY}`,
            as.bureau,
            { value: false },
            { 'if-match': '"0"' }
        );
        expect(own.statusCode).toBe(422);
        expect(own.json()).toMatchObject({ code: 'setting_level_not_allowed' });
        const stale = await api.call(
            'PUT',
            regionUrl(),
            { ...as.bureau, authAge: 3600 },
            { value: false },
            { 'if-match': '"0"' }
        );
        expect(stale.statusCode).toBe(401);
        expect((await register(as.records)).statusCode).toBe(200);
    }, 60_000);
});
