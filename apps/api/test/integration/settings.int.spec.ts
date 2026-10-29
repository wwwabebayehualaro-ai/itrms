/**
 * The settings registry over HTTP (task 0.21a), on a real PostgreSQL 16 with the Wolaita seeds and Test Zone B: values
 * set at the region, the zone, a unit and a unit type, resolved along each unit's real ancestors; sibling offices (Damot
 * Gale, Boditi) and another zone never see or change each other's values; a level a setting does not allow is refused;
 * reset brings back what the unit inherits; a person's own choice follows them; every write is audited, based on the
 * version read, and a sensitive setting needs a fresh second factor.
 */
import { defineModule } from '@itrms/module-sdk';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    bureauAdmin: '0199f0a0-d000-7000-8000-000000000001',
    zoneAdmin: '0199f0a0-d000-7000-8000-000000000102',
    damotRecords: '0199f0a0-d000-7000-8000-000000000202',
    damotAdmin: '0199f0a0-d000-7000-8000-00000000a101',
    boditiAdmin: '0199f0a0-d000-7000-8000-00000000a102',
    tzbAdmin: '0199f0a0-d000-7000-8000-00000000a103'
};

/** A slice of the suite's own: a sensitive setting (a change needs a fresh second factor). */
const probe = {
    manifest: defineModule({
        key: 'probe',
        layer: 'platform',
        version: '0.0.0',
        dependsOn: ['kernel'],
        settings: [{ key: 'probe.lockMinutes', default: 15, overridableAt: ['region', 'unit'], sensitive: true }]
    }),
    settings: { 'probe.lockMinutes': z.number().int().min(1).max(120) },
    messages: {
        am: { 'probe.setting.lockMinutes': 'የመቆለፊያ ደቂቃዎች' },
        en: { 'probe.setting.lockMinutes': 'Lock minutes' }
    }
};

interface Setting {
    key: string;
    value: unknown;
    source: { level: string; unitId?: string; unitTypeId?: string };
    inherited: { value: unknown; source: { level: string; unitId?: string } } | null;
    own: { value: unknown; version: number } | null;
    unitType: { value: unknown; version: number } | null;
    writable: { unit: boolean; unitType: boolean };
    schema: { enum?: string[] };
}

interface UnitSettings {
    unitId: string;
    unitType: { id: string } | null;
    settings: Setting[];
}

let pg: TestPostgres;
let api: TestApi;
let region: OrgUnit;
let zone: OrgUnit;
let damot: OrgUnit;
let boditi: OrgUnit;
let sodoZuria: OrgUnit;
let tzb: OrgUnit;
let tzbW1: OrgUnit;

const as = (sub: string, unit: OrgUnit, authAge?: number): As => ({ sub, unit, authAge });
const put = (who: As, url: string, value: unknown, version: number | null) =>
    api.call('PUT', url, who, { value }, version === null ? {} : { 'if-match': `"${version}"` });
const reset = (who: As, url: string, version: number) =>
    api.call('DELETE', url, who, undefined, { 'if-match': `"${version}"` });
const settingsOf = async (who: As, unit: OrgUnit) => {
    const res = await api.call('GET', `/api/v1/org-units/${unit.id}/settings`, who);
    expect(res.statusCode).toBe(200);
    return res.json<UnitSettings>();
};
const settingOf = async (who: As, unit: OrgUnit, key: string): Promise<Setting> => {
    const found = (await settingsOf(who, unit)).settings.find((s) => s.key === key);
    if (!found) throw new Error(`no setting ${key}`);
    return found;
};
const workspaceSettings = async (who: As) =>
    (await api.call('GET', '/api/v1/me/workspace', who)).json<{ settings: Record<string, unknown> }>().settings;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.damot.admin',
                sub: SUB.damotAdmin,
                region: 'SER',
                home: 'WOL-DAMOT-GALE',
                roles: [['WOL-DAMOT-GALE', 'unit_admin']]
            },
            {
                username: 'test.boditi.admin',
                sub: SUB.boditiAdmin,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'unit_admin']]
            },
            {
                username: 'test.tzb.admin',
                sub: SUB.tzbAdmin,
                region: 'SER',
                home: 'TZB',
                roles: [['TZB', 'unit_admin']]
            }
        ],
        { slices: [probe], installationSettings: { 'i18n.languages': ['am', 'en', 'om'] } }
    );
    region = await api.unit('SER', 'SER');
    zone = await api.unit('SER', 'WOL');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    boditi = await api.unit('SER', 'WOL-BODITI');
    sodoZuria = await api.unit('SER', 'WOL-SODO-ZURIA');
    tzb = await api.unit('SER', 'TZB');
    tzbW1 = await api.unit('SER', 'TZB-W1');
}, 240_000);

afterAll(async () => {
    await api?.close();
    await pg?.stop();
});

describe('settings down the tree', () => {
    it("holds a zone's value in its subtree only, a unit's own above it, and keeps sibling offices apart", async () => {
        const bureau = as(SUB.bureauAdmin, region);
        const zoneAdmin = as(SUB.zoneAdmin, zone);
        const damotAdmin = as(SUB.damotAdmin, damot);
        const boditiAdmin = as(SUB.boditiAdmin, boditi);
        const tzbAdmin = as(SUB.tzbAdmin, tzb);
        const url = (unit: OrgUnit) => `/api/v1/org-units/${unit.id}/settings/ui.density`;

        expect((await put(bureau, url(region), 'compact', 0)).statusCode).toBe(200);
        expect((await put(zoneAdmin, url(zone), 'comfortable', 0)).json()).toEqual({
            key: 'ui.density',
            value: 'comfortable',
            version: 1
        });

        // Damot Gale inherits the zone's; Test Zone B's woreda the region's
        expect(await settingOf(damotAdmin, damot, 'ui.density')).toMatchObject({
            value: 'comfortable',
            source: { level: 'unit', unitId: zone.id },
            own: null,
            writable: { unit: true, unitType: false }
        });
        expect(await settingOf(tzbAdmin, tzbW1, 'ui.density')).toMatchObject({
            value: 'compact',
            source: { level: 'region', unitId: region.id }
        });

        // Damot Gale's own value: its own, not its sibling's
        expect((await put(damotAdmin, url(damot), 'compact', 0)).statusCode).toBe(200);
        expect(await settingOf(damotAdmin, damot, 'ui.density')).toMatchObject({
            value: 'compact',
            source: { level: 'unit', unitId: damot.id },
            inherited: { value: 'comfortable', source: { level: 'unit', unitId: zone.id } },
            own: { value: 'compact', version: 1 }
        });
        expect(await settingOf(boditiAdmin, boditi, 'ui.density')).toMatchObject({
            value: 'comfortable',
            source: { level: 'unit', unitId: zone.id }
        });
        // the zone sees what its woreda chose; the person acting for it there gets it too
        expect((await settingOf(zoneAdmin, damot, 'ui.density')).value).toBe('compact');
        expect((await workspaceSettings(as(SUB.damotRecords, damot)))['ui.density']).toBe('compact');

        // a sibling office and another zone neither see nor change it (404: not theirs to know)
        expect((await api.call('GET', `/api/v1/org-units/${damot.id}/settings`, boditiAdmin)).statusCode).toBe(404);
        expect((await put(boditiAdmin, url(damot), 'comfortable', 1)).statusCode).toBe(404);
        expect((await api.call('GET', `/api/v1/org-units/${zone.id}/settings`, tzbAdmin)).statusCode).toBe(404);

        // above the person's seat: 403 alike for a value that exists and one that does not (follow-up 89)
        expect((await put(damotAdmin, url(zone), 'compact', 1)).statusCode).toBe(403);
        expect(
            (await put(damotAdmin, `/api/v1/org-units/${zone.id}/settings/forms.exports.keepDays`, 3, 0)).statusCode
        ).toBe(403);
        expect(
            (await put(zoneAdmin, `/api/v1/org-units/${region.id}/settings/i18n.languages`, ['am', 'en'], 0)).statusCode
        ).toBe(403);

        // a second administrator who read the default before is refused, not allowed to overwrite
        const late = await put(zoneAdmin, url(zone), 'compact', 0);
        expect(late.statusCode).toBe(409);
        expect(late.json()).toMatchObject({ code: 'stale_version' });
    });

    it("lets the region choose for a unit type, which beats the units above but not a unit's own; reset inherits", async () => {
        const bureau = as(SUB.bureauAdmin, region);
        const damotAdmin = as(SUB.damotAdmin, damot);
        const typeId = damot.unitTypeId ?? '';
        expect(sodoZuria.unitTypeId).toBe(typeId);
        const typeUrl = `/api/v1/unit-types/${typeId}/settings/ui.density`;

        // only a seat at the region chooses for a unit type
        expect((await put(as(SUB.zoneAdmin, zone), typeUrl, 'compact', 0)).statusCode).toBe(403);
        expect((await put(bureau, typeUrl, 'compact', 0)).statusCode).toBe(200);
        expect(await settingOf(bureau, sodoZuria, 'ui.density')).toMatchObject({
            value: 'compact',
            source: { level: 'unitType', unitTypeId: typeId },
            // what the type's reset would bring its units back to
            inheritedWithoutType: { value: 'comfortable', source: { level: 'unit', unitId: zone.id } },
            unitType: { value: 'compact', version: 1 },
            writable: { unit: true, unitType: true }
        });
        // a town (another type) keeps the zone's
        expect((await settingOf(bureau, boditi, 'ui.density')).value).toBe('comfortable');

        // Damot Gale resets its own value: it inherits its type's now
        const unitUrl = `/api/v1/org-units/${damot.id}/settings/ui.density`;
        expect((await reset(damotAdmin, unitUrl, 2)).statusCode).toBe(409);
        expect((await reset(damotAdmin, unitUrl, 1)).statusCode).toBe(204);
        expect(await settingOf(damotAdmin, damot, 'ui.density')).toMatchObject({
            value: 'compact',
            source: { level: 'unitType', unitTypeId: typeId },
            own: null
        });
        expect((await reset(damotAdmin, unitUrl, 1)).statusCode).toBe(404);

        // the region resets its value for the type: Sodo Zuria inherits the zone's again
        expect((await reset(bureau, typeUrl, 1)).statusCode).toBe(204);
        expect((await settingOf(bureau, sodoZuria, 'ui.density')).source).toEqual({ level: 'unit', unitId: zone.id });
        // a unit type of another region is not found
        expect(
            (
                await put(
                    bureau,
                    '/api/v1/unit-types/0199f0a0-d000-7000-8000-00000000ffff/settings/ui.density',
                    'compact',
                    0
                )
            ).statusCode
        ).toBe(404);
    });

    it('refuses a level a setting does not allow, a value its schema rejects, an unknown key, and a person without the right', async () => {
        const bureau = as(SUB.bureauAdmin, region);
        const zoneAdmin = as(SUB.zoneAdmin, zone);
        // the theme is the region's choice (and each person's), never a zone's or a unit type's
        const zoneTheme = await put(zoneAdmin, `/api/v1/org-units/${zone.id}/settings/ui.theme`, 'dark', 0);
        expect(zoneTheme.statusCode).toBe(422);
        expect(zoneTheme.json()).toMatchObject({ code: 'setting_level_not_allowed' });
        expect(
            (await put(bureau, `/api/v1/unit-types/${damot.unitTypeId}/settings/ui.theme`, 'dark', 0)).json()
        ).toMatchObject({ code: 'setting_level_not_allowed' });
        expect((await settingOf(zoneAdmin, zone, 'ui.theme')).writable).toEqual({ unit: false, unitType: false });

        const bad = await put(bureau, `/api/v1/org-units/${region.id}/settings/ui.theme`, 'purple', 0);
        expect(bad.statusCode).toBe(422);
        expect(bad.json()).toMatchObject({ code: 'validation_failed' });
        // a region may lower the background export limit, never raise it
        expect(
            (await put(bureau, `/api/v1/org-units/${region.id}/settings/forms.exports.backgroundMaxRows`, 500_000, 0))
                .statusCode
        ).toBe(422);
        expect((await put(bureau, `/api/v1/org-units/${region.id}/settings/security.unknown`, 1, 0)).statusCode).toBe(
            404
        );
        expect((await put(bureau, `/api/v1/org-units/${region.id}/settings/ui.theme`, 'dark', null)).statusCode).toBe(
            400
        );
        // a records officer administers no settings
        const records = as(SUB.damotRecords, damot);
        expect((await api.call('GET', `/api/v1/org-units/${damot.id}/settings`, records)).statusCode).toBe(403);
    });

    it("shows the installation's value under the region's, and the region's languages over it", async () => {
        const bureau = as(SUB.bureauAdmin, region);
        expect(await settingOf(bureau, region, 'i18n.languages')).toMatchObject({
            value: ['am', 'en', 'om'],
            source: { level: 'installation' },
            writable: { unit: true, unitType: false }
        });
        const url = `/api/v1/org-units/${region.id}/settings/i18n.languages`;
        expect((await put(bureau, url, ['en', 'wal-Latn'], 0)).statusCode).toBe(422);
        expect((await put(bureau, url, ['am', 'en', 'wal-Latn'], 0)).statusCode).toBe(200);
        expect((await workspaceSettings(as(SUB.damotRecords, damot)))['i18n.languages']).toEqual([
            'am',
            'en',
            'wal-Latn'
        ]);
        expect(await settingOf(bureau, region, 'i18n.languages')).toMatchObject({
            source: { level: 'region', unitId: region.id },
            inherited: { value: ['am', 'en', 'om'], source: { level: 'installation' } }
        });
    });

    it('needs a fresh second factor to change a sensitive setting', async () => {
        const url = `/api/v1/org-units/${zone.id}/settings/probe.lockMinutes`;
        const old = await put(as(SUB.zoneAdmin, zone, 3600), url, 10, 0);
        expect(old.statusCode).toBe(401);
        expect(old.json()).toMatchObject({ code: 'step_up_required' });
        expect((await put(as(SUB.zoneAdmin, zone, 10), url, 10, 0)).statusCode).toBe(200);
        expect((await reset(as(SUB.zoneAdmin, zone, 3600), url, 1)).statusCode).toBe(401);
    });

    it('audits every write in its transaction', async () => {
        const { rows } = await api.owner.query<{ action: string; n: number }>(
            `select action, count(*)::int as n from kernel.audit_log
              where table_name = 'kernel.settings_values' group by action order by action`
        );
        const count = Object.fromEntries(rows.map((r) => [r.action, r.n]));
        // inserts: region, zone, Damot Gale, the unit type, the languages, the probe; deletes: Damot Gale, the type
        expect(count).toMatchObject({ insert: 6, delete: 2 });
        const { rows: stored } = await api.owner.query<{ n: number }>(
            'select count(*)::int as n from kernel.settings_values'
        );
        expect(stored[0]?.n).toBe(4);
    });
});

describe("a person's own choice", () => {
    it('follows them to another office and another PC, and resets to the office they act for', async () => {
        const records = as(SUB.damotRecords, damot);
        const bureau = as(SUB.bureauAdmin, region);
        expect((await put(bureau, `/api/v1/org-units/${region.id}/settings/ui.theme`, 'light', 0)).statusCode).toBe(
            200
        );
        expect(
            (await api.call('PATCH', '/api/v1/me/preferences', records, { favourites: ['kernel.home'] })).statusCode
        ).toBe(200);

        const mine = await api.call('PUT', '/api/v1/me/settings/ui.theme', records, { value: 'dark' });
        expect(mine.statusCode).toBe(200);
        expect(mine.json()).toEqual({ key: 'ui.theme', value: 'dark' });
        const workspace = (await api.call('GET', '/api/v1/me/workspace', records)).json<{
            settings: Record<string, unknown>;
            officeSettings: Record<string, unknown>;
            preferences: Record<string, unknown>;
        }>();
        expect(workspace.settings['ui.theme']).toBe('dark');
        // the office's value beside it (a choice equal to it is reset by the shell), only for the personal choices
        expect(workspace.officeSettings['ui.theme']).toBe('light');
        expect(workspace.officeSettings).not.toHaveProperty('i18n.languages');
        // their other preferences are kept, and read as before
        expect(workspace.preferences).toEqual({ favourites: ['kernel.home'] });
        // nobody else's
        expect((await workspaceSettings(as(SUB.zoneAdmin, zone)))['ui.theme']).toBe('light');

        // not a personal choice, or not a value of it
        expect(
            (await api.call('PUT', '/api/v1/me/settings/i18n.languages', records, { value: ['am', 'en'] })).json()
        ).toMatchObject({
            code: 'setting_level_not_allowed'
        });
        expect((await api.call('PUT', '/api/v1/me/settings/ui.theme', records, { value: 'purple' })).statusCode).toBe(
            422
        );
        expect((await api.call('PUT', '/api/v1/me/settings/ui.unknown', records, { value: 'x' })).statusCode).toBe(404);

        expect((await api.call('DELETE', '/api/v1/me/settings/ui.theme', records)).statusCode).toBe(204);
        expect((await workspaceSettings(records))['ui.theme']).toBe('light');
        const { rows } = await api.owner.query<{ diff: { keys: string[] } }>(
            `select diff from kernel.audit_log where event_type = 'user.preferences_changed'
                and actor_id = (select id from kernel.users where keycloak_sub = $1) order by at`,
            [SUB.damotRecords]
        );
        expect(rows.map((r) => r.diff.keys)).toEqual([['favourites'], ['ui.theme'], ['ui.theme']]);
    });
});
