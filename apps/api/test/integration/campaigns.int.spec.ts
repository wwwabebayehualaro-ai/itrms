/**
 * Campaign counters (ADR-0054 §2, task 1.13i) through the API, on a real PostgreSQL 16 with the Wolaita seeds. The zone runs a bolo
 * season and a plate exchange, sets the targets of the offices below it (on record, If-Match for a change; an office never sets its
 * own), and each office's count of today and so far equals an independent SQL count of the typed tables, within the campaign's
 * days. The register is read region-wide (class R), so a sibling office must never see another's count; an office reads the campaign
 * of its zone through RLS (class C) and its own target (class T). Plates, chassis numbers, references, names and phones are generated.
 */
import { randomInt, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { CampaignService, VehicleImportService, daysAfter } from '@itrms/competency/api';
import { vehicleImportHandlers } from '@itrms/competency/api/worker';
import {
    addisDay,
    type Campaign,
    type CampaignList,
    type CampaignProgress,
    type VehicleImport
} from '@itrms/competency/contracts';
import competencyAm from '@itrms/competency/messages/am';
import competencyEn from '@itrms/competency/messages/en';
import { importBackCaptureService } from '@itrms/competency/seed';
import { loadSlices } from '@itrms/kernel/api';
import { createDatabase, type Database } from '@itrms/kernel/db';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import { NO_OBJECT_STORE } from '@itrms/kernel/files';
import { permissionsOf, rolePermissions } from '@itrms/kernel/iam';
import type { OrgUnit } from '@itrms/kernel/org';
import { contextFor, TEST_CONTEXT_KEY } from '@itrms/kernel/testing';
import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { importVehicleCategories } from '@itrms/vehicles/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SLICES } from '../../src/slices';
import { startApi, type As, type TestApi } from './support/api';
import { startPostgres, type TestPostgres } from './support/postgres';

const SUB = {
    clerk: '0199f0a0-d000-7000-8000-00000000d501',
    verifier: '0199f0a0-d000-7000-8000-00000000d502',
    zone: '0199f0a0-d000-7000-8000-00000000d503'
};
type Who = keyof typeof SUB;

let pg: TestPostgres;
let api: TestApi;
let app: Database;
let system: SystemDatabase;
let boditi: OrgUnit;
let zone: OrgUnit;
/** a sibling office of Boditi (a woreda: it holds no competency roles, so it is read as an office, under RLS) */
let damot: OrgUnit;
const as = {} as Record<Who, As>;
const id = {} as Record<Who, string>;
const catalogue = rolePermissions(loadSlices(SLICES).manifests);
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const detailOf = (key: keyof typeof competencyEn) => [competencyAm[key], competencyEn[key]];

const TODAY = addisDay();
const STARTS = daysAfter(TODAY, -3);
const ENDS = daysAfter(TODAY, 10);
const YESTERDAY = daysAfter(TODAY, -1);
/** before the campaigns start */
const BEFORE = daysAfter(TODAY, -10);

const handlers = () =>
    vehicleImportHandlers(system, {
        database: app,
        importer: api.http.get(VehicleImportService),
        permissionsOf: (roles) => permissionsOf(catalogue, roles)
    });
const runCheck = (importId: string) =>
    handlers()['vehicle-import.check-requested.v1']?.({
        eventId: randomUUID(),
        type: 'vehicle-import.check-requested.v1',
        payload: { importId }
    });
const runCommit = (importId: string) =>
    handlers()['vehicle-import.commit-requested.v1']?.({
        eventId: randomUUID(),
        type: 'vehicle-import.commit-requested.v1',
        payload: { importId }
    });

const RUN = String(randomInt(100000, 999999));
const ETHIOPIC = 'ለመረሰሸቀበተቸነኘአከወዘዠየደጀገጠጨጰፈፐ';
const nameOf = (n: number) =>
    [Math.floor(n / 900) % 30, Math.floor(n / 30) % 30, n % 30].map((i) => ETHIOPIC[i] ?? 'ለ').join('');
function vin(n: number): string {
    const base = `1HGCM82B0${String((n % 90) + 10)}${RUN.slice(0, 2)}${String(n).padStart(4, '0')}`;
    const digit = vinCheckDigit(base) ?? '0';
    return `${base.slice(0, 8)}${digit}${base.slice(9)}`;
}
const reference = (n: number) => `BOD/CMP/${RUN}/${String(n).padStart(4, '0')}`;
/** the old regional plate of a use code */
const plate = (n: number, code: number) => `AA ${code}-${RUN.slice(0, 1)}${String(n).padStart(4, '0')}`;

const COLUMNS = [
    'paper_reference',
    'first_registered_on',
    'owners_since',
    'plate',
    'chassis_number',
    'make',
    'model',
    'model_year',
    'category',
    'use',
    'colour',
    'owner_name_am',
    'owner_sex',
    'owner_phone'
] as const;

/** Paper files n..n+count-1 of one plate code, each with its own owner (a name and a phone). */
function sheet(from: number, count: number, code: number): string {
    const rows: string[][] = [];
    for (let n = from; n < from + count; n++)
        rows.push([
            reference(n),
            '04/09/2001',
            '2015-03-01',
            plate(n, code),
            vin(n),
            'Toyota',
            'Corolla',
            '2008',
            'automobile',
            'private',
            'Blue',
            `ባለቤት ${nameOf(n)} ታደሰ`,
            n % 2 ? 'male' : 'female',
            `09${RUN.slice(0, 2)}${String(n).padStart(6, '0')}`
        ]);
    return [COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

/** Scans the clerk uploaded, stored at Boditi, one per paper reference. */
async function scans(references: string[]): Promise<string[]> {
    const { rows } = await api.owner.query<{ id: string }>(
        `insert into kernel.files (id, region_id, unit_id, status, filename, content_type, size, sha256, object_key, confirmed_at,
                                   origin, created_by, expires_at)
         select g.id, $1::uuid, $2::uuid, 'stored', g.name || '.pdf', 'application/pdf', 10, repeat('a', 64),
                'files/' || $1::text || '/' || g.id::text, now(), 'upload', $3::uuid, now() + interval '7 days'
           from (select gen_random_uuid() as id, unnest($4::text[]) as name) g
         returning id`,
        [boditi.regionId, boditi.id, id.clerk, references.map((r) => r.replaceAll('/', '-'))]
    );
    return rows.map((r) => r.id);
}

const batchOf = async (importId: string, who: As = as.clerk) =>
    (await api.call('GET', `/api/v1/vehicle-imports/${importId}`, who)).json<VehicleImport>();

/** A sheet of vehicles migrated onto the register at Boditi: sent, checked, committed by the second person. */
async function migrate(from: number, count: number, code: number, filename: string): Promise<void> {
    const refs = Array.from({ length: count }, (_, i) => reference(from + i));
    const sent = await api.call('POST', '/api/v1/vehicle-imports', as.clerk, {
        filename,
        format: 'csv',
        content: sheet(from, count, code),
        scanFileIds: await scans(refs)
    });
    expect(sent.statusCode, sent.body).toBe(202);
    await runCheck(sent.json<VehicleImport>().id);
    const checked = await batchOf(sent.json<VehicleImport>().id, as.verifier);
    expect(checked).toMatchObject({ state: 'checked', counts: { valid: count } });
    const commit = await api.call(
        'POST',
        `/api/v1/vehicle-imports/${checked.id}/commit`,
        as.verifier,
        {},
        ifMatch(checked.version)
    );
    expect(commit.statusCode, commit.body).toBe(202);
    await runCommit(checked.id);
    expect(await batchOf(checked.id)).toMatchObject({ state: 'committed', counts: { imported: count } });
}

const requestIdOf = (res: { headers: Record<string, unknown> }): string => {
    const header = res.headers['x-request-id'];
    return typeof header === 'string' ? header : '';
};
async function auditOf(requestId: string): Promise<Record<string, number>> {
    const { rows } = await api.owner.query<{ line: string; n: number }>(
        `select table_name || ':' || action as line, count(*)::int as n from kernel.audit_log where request_id = $1 group by 1`,
        [requestId]
    );
    return Object.fromEntries(rows.map((r) => [r.line, r.n]));
}

const body = (kind: 'bolo_season' | 'plate_exchange', extra: object = {}) => ({
    kind,
    name: {
        am: kind === 'bolo_season' ? 'የቦሎ ወቅት' : 'የሰሌዳ ልውውጥ',
        en: kind === 'bolo_season' ? 'Bolo season' : 'Plate exchange'
    },
    startsOn: STARTS,
    endsOn: ENDS,
    ...extra
});
const create = (who: As, payload: object) => api.call('POST', '/api/v1/campaigns', who, payload);
const progressOf = async (who: As, campaignId: string) => {
    const res = await api.call('GET', `/api/v1/campaigns/${campaignId}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<CampaignProgress>();
};
const putTarget = (who: As, campaignId: string, payload: object, headers?: Record<string, string>) =>
    api.call('PUT', `/api/v1/campaigns/${campaignId}/targets`, who, payload, headers);
const officeOf = (progress: CampaignProgress, code: string) => {
    const office = progress.offices.find((o) => o.unit.code === code);
    if (!office) throw new Error(`no office ${code} in the campaign`);
    return office;
};

/** the vehicles of the migrated sheet, oldest first */
const vehicleIds: string[] = [];
let bolo: Campaign;
let exchange: Campaign;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(
        pg,
        [
            {
                username: 'test.cmp.clerk',
                sub: SUB.clerk,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [
                    ['WOL-BODITI', 'records_officer'],
                    ['WOL-BODITI', 'competency.officer']
                ]
            },
            {
                username: 'test.cmp.verifier',
                sub: SUB.verifier,
                region: 'SER',
                home: 'WOL-BODITI',
                roles: [['WOL-BODITI', 'competency.officer']]
            },
            {
                username: 'test.cmp.zone',
                sub: SUB.zone,
                region: 'SER',
                home: 'WOL',
                roles: [['WOL', 'competency.lead']]
            }
        ],
        { objectStore: { ...NO_OBJECT_STORE, presignGet: ({ key }) => Promise.resolve(`https://store.test/${key}`) } }
    );
    app = createDatabase(pg.url('app'), { contextKey: TEST_CONTEXT_KEY });
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    const region = await api.unit('SER', 'SER');
    boditi = await api.unit('SER', 'WOL-BODITI');
    zone = await api.unit('SER', 'WOL');
    damot = await api.unit('SER', 'WOL-DAMOT-GALE');
    as.clerk = { sub: SUB.clerk, unit: boditi };
    as.verifier = { sub: SUB.verifier, unit: boditi };
    as.zone = { sub: SUB.zone, unit: zone };
    for (const who of Object.keys(SUB) as Who[]) id[who] = await api.userId(SUB[who]);
    await api.installer.scoped({}, async (tx) => {
        const root = { id: region.id, regionId: region.regionId };
        await importVehicleCategories(tx, root);
        await importBackCaptureService(tx, root);
    });
}, 240_000);

afterAll(async () => {
    await system?.close();
    await app?.close();
    await api?.close();
    await pg?.stop();
});

describe('a campaign', () => {
    it('is created by the unit that runs it, on record, with its days', async () => {
        const res = await create(as.zone, body('bolo_season'));
        expect(res.statusCode, res.body).toBe(201);
        bolo = res.json<Campaign>();
        expect(bolo).toMatchObject({
            kind: 'bolo_season',
            startsOn: STARTS,
            endsOn: ENDS,
            closedAt: null,
            unit: { code: 'WOL' },
            version: 1
        });
        expect(await auditOf(requestIdOf(res))).toMatchObject({ 'competency.campaigns:insert': 1 });
        const other = await create(as.zone, body('plate_exchange'));
        expect(other.statusCode, other.body).toBe(201);
        exchange = other.json<Campaign>();
        const row = await api.owner.query<{ handling_unit_id: string; name: { en: string } }>(
            'select handling_unit_id, name from competency.campaigns where id = $1',
            [bolo.id]
        );
        expect(row.rows[0]).toMatchObject({ handling_unit_id: zone.id, name: { en: 'Bolo season' } });
    });

    it('refuses an overlapping campaign of the same kind at the same unit with 409', async () => {
        const overlap = await create(as.zone, body('bolo_season', { startsOn: ENDS, endsOn: daysAfter(ENDS, 20) }));
        expect(overlap.statusCode, overlap.body).toBe(409);
        expect(detailOf('competency.errors.campaign_overlap')).toContain(overlap.json<{ detail?: string }>().detail);
        // another kind, or the days after it, are not an overlap
        const after = await create(
            as.zone,
            body('bolo_season', { startsOn: daysAfter(ENDS, 1), endsOn: daysAfter(ENDS, 30) })
        );
        expect(after.statusCode, after.body).toBe(201);
    });

    it('refuses a body that is not one with 422', async () => {
        for (const bad of [
            body('bolo_season', { endsOn: daysAfter(STARTS, -1) }),
            body('bolo_season', { endsOn: daysAfter(STARTS, 366) }),
            body('bolo_season', { kind: 'other' }),
            body('bolo_season', { name: { en: 'only English' } }),
            body('bolo_season', { startsOn: '01/11/2026' }),
            body('bolo_season', { extra: true }),
            { kind: 'bolo_season' }
        ]) {
            const res = await create(as.zone, bad);
            expect(res.statusCode, JSON.stringify(bad)).toBe(422);
        }
    });
});

describe('the targets', () => {
    it('are set by the unit above the office, on record, with If-Match for a change', async () => {
        const created = await putTarget(as.zone, bolo.id, { unitId: boditi.id, target: 20 });
        expect(created.statusCode, created.body).toBe(200);
        expect(officeOf(created.json<CampaignProgress>(), 'WOL-BODITI').target).toEqual({ count: 20, version: 1 });
        expect(await auditOf(requestIdOf(created))).toMatchObject({ 'competency.campaign_targets:insert': 1 });
        const row = await api.owner.query<{ set_by_unit_id: string; handling_unit_id: string }>(
            'select set_by_unit_id, handling_unit_id from competency.campaign_targets where campaign_id = $1',
            [bolo.id]
        );
        expect(row.rows[0]).toEqual({ set_by_unit_id: zone.id, handling_unit_id: boditi.id });

        // a target already there is replaced only on its version; without one or with a stale one it is a conflict
        expect((await putTarget(as.zone, bolo.id, { unitId: boditi.id, target: 25 })).statusCode).toBe(409);
        expect((await putTarget(as.zone, bolo.id, { unitId: boditi.id, target: 25 }, ifMatch(99))).statusCode).toBe(
            409
        );
        // a new target never carries a version
        expect((await putTarget(as.zone, bolo.id, { unitId: damot.id, target: 5 }, ifMatch(1))).statusCode).toBe(409);

        const updated = await putTarget(as.zone, bolo.id, { unitId: boditi.id, target: 25 }, ifMatch(1));
        expect(updated.statusCode, updated.body).toBe(200);
        expect(officeOf(updated.json<CampaignProgress>(), 'WOL-BODITI').target).toEqual({ count: 25, version: 2 });
        expect(await auditOf(requestIdOf(updated))).toMatchObject({ 'competency.campaign_targets:update': 1 });
        // back to 20, as the counts below are read against it
        const again = await putTarget(as.zone, bolo.id, { unitId: boditi.id, target: 20 }, ifMatch(2));
        expect(again.statusCode, again.body).toBe(200);

        // a second office has a target and no count
        const second = await putTarget(as.zone, bolo.id, { unitId: damot.id, target: 5 });
        expect(second.statusCode, second.body).toBe(200);
        expect(officeOf(second.json<CampaignProgress>(), 'WOL-DAMOT-GALE')).toMatchObject({
            today: 0,
            total: 0,
            expected: 1,
            onTrack: false
        });
    });

    it('are never set by an office for itself, nor for an office the caller does not hold', async () => {
        for (const who of [as.verifier, as.clerk]) {
            const own = await putTarget(who, bolo.id, { unitId: boditi.id, target: 1 });
            expect(own.statusCode, own.body).toBe(403);
            expect(detailOf('competency.errors.campaign_target_own_office')).toContain(
                own.json<{ detail?: string }>().detail
            );
        }
        const sibling = await putTarget(as.verifier, bolo.id, { unitId: damot.id, target: 1 });
        expect([403, 404]).toContain(sibling.statusCode);
        // the zone is no exception for its own unit
        const zoneOwn = await putTarget(as.zone, bolo.id, { unitId: zone.id, target: 1 });
        expect(zoneOwn.statusCode).toBe(403);
        const none = await api.owner.query<{ n: number }>(
            'select count(*)::int as n from competency.campaign_targets where handling_unit_id in ($1, $2) and target = 1',
            [zone.id, damot.id]
        );
        expect(none.rows[0]?.n).toBe(0);
    });

    it('are refused for an office outside the campaign’s subtree with 422', async () => {
        // Boditi runs a campaign of its own: the zone is above Boditi, but Boditi is not below its own campaign
        const own = await create(as.verifier, body('bolo_season'));
        expect(own.statusCode, own.body).toBe(201);
        const res = await putTarget(as.zone, own.json<Campaign>().id, { unitId: boditi.id, target: 3 });
        expect(res.statusCode, res.body).toBe(422);
        expect(JSON.stringify(res.json())).toContain('unitId');
    });

    it('refuse a body that is not one with 422', async () => {
        const good = { unitId: boditi.id, target: 1 };
        for (const bad of [
            { ...good, target: 0 },
            { ...good, target: 10_000_001 },
            { ...good, target: 1.5 },
            { ...good, unitId: 'not-an-id' },
            { ...good, extra: true },
            { unitId: boditi.id }
        ]) {
            const res = await putTarget(as.zone, bolo.id, bad, ifMatch(3));
            expect(res.statusCode, JSON.stringify(bad)).toBe(422);
        }
    });
});

describe('the daily counts', () => {
    it('are the records of the typed tables on their day, within the campaign, as an independent SQL count has them', async () => {
        await migrate(0, 6, 3, 'boditi-campaign.csv');
        const found = await api.owner.query<{ id: string }>(
            'select id from vehicles.vehicles where handling_unit_id = $1 and migration_source is not null order by created_at, id',
            [boditi.id]
        );
        vehicleIds.push(...found.rows.map((r) => r.id));
        expect(vehicleIds.length).toBe(6);
        const [v0, v1, v2, v3, v4, v5] = vehicleIds;

        const addBolo = (vehicle: string | undefined, day: string, status = 'awaiting_sticker', fiscalYear = 2019) =>
            api.owner.query(
                `insert into competency.bolos (id, region_id, handling_unit_id, vehicle_id, case_id, status, use, checklist_serial,
                                               inspected_on, fiscal_year, valid_until, insurance_certificate, insurer, insured_from,
                                               insured_until, void_reason)
                 values (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), $4, 'private', $5, $6::date, $7, $6::date + 300,
                         'INS-1', 'Sample Insurer', $6::date - 30, $6::date + 300, $8)`,
                [
                    boditi.regionId,
                    boditi.id,
                    vehicle,
                    status,
                    `CL-${RUN}-${randomInt(100000, 999999)}`,
                    day,
                    fiscalYear,
                    status === 'void' ? 'test' : null
                ]
            );
        await addBolo(v0, TODAY);
        await addBolo(v1, TODAY);
        await addBolo(v2, YESTERDAY);
        // before the campaign starts, and void: neither counts
        await addBolo(v3, BEFORE);
        await addBolo(v4, TODAY, 'void');

        const endPlate = (vehicle: string | undefined, day: string, reason: string) =>
            api.owner.query(
                'update vehicles.plate_assignments set until = $2::date, ended_reason = $3 where vehicle_id = $1 and until is null',
                [vehicle, day, reason]
            );
        await endPlate(v0, TODAY, 'exchanged');
        await endPlate(v1, YESTERDAY, 'exchanged');
        await endPlate(v2, YESTERDAY, 'exchanged');
        // before the campaign starts, and lost rather than exchanged: neither counts
        await endPlate(v3, BEFORE, 'exchanged');
        await endPlate(v5, TODAY, 'lost');

        const set = await putTarget(as.zone, exchange.id, { unitId: boditi.id, target: 2 });
        expect(set.statusCode, set.body).toBe(200);

        const sqlCount = async (table: 'bolos' | 'plates', day?: string) => {
            const q =
                table === 'bolos'
                    ? `select count(*)::int as n from competency.bolos where handling_unit_id = $1 and status <> 'void'
                          and inspected_on between $2::date and $3::date`
                    : `select count(*)::int as n from vehicles.plate_assignments where handling_unit_id = $1
                          and ended_reason = 'exchanged' and until between $2::date and $3::date`;
            return (await api.owner.query<{ n: number }>(q, [boditi.id, day ?? STARTS, day ?? TODAY])).rows[0]?.n;
        };

        const bolos = officeOf(await progressOf(as.zone, bolo.id), 'WOL-BODITI');
        expect(bolos.today).toBe(await sqlCount('bolos', TODAY));
        expect(bolos.total).toBe(await sqlCount('bolos'));
        expect(bolos).toMatchObject({ today: 2, total: 3, target: { count: 20 } });
        // 4 of the 14 days have come by: 20 × 4 / 14 = 5.7, so 6 are expected, and 3 are behind
        expect(bolos).toMatchObject({ expected: 6, onTrack: false });
        expect(bolos.series).toHaveLength(14);
        expect(bolos.series.at(-1)).toEqual({ day: TODAY, count: 2 });
        expect(bolos.series.at(-2)).toEqual({ day: YESTERDAY, count: 1 });
        expect(bolos.series.reduce((n, d) => n + d.count, 0)).toBe(3);

        const exchanged = officeOf(await progressOf(as.zone, exchange.id), 'WOL-BODITI');
        expect(exchanged.today).toBe(await sqlCount('plates', TODAY));
        expect(exchanged.total).toBe(await sqlCount('plates'));
        expect(exchanged).toMatchObject({ today: 1, total: 3, expected: 1, onTrack: true });
        expect(exchanged.series.at(-2)).toEqual({ day: YESTERDAY, count: 2 });

        // the totals add the offices: Damot Gale has a target and no count
        const all = await progressOf(as.zone, bolo.id);
        expect(all.total).toEqual({ today: 2, total: 3, target: 25, expected: 7 });
        expect(all).toMatchObject({ mayManage: true, ownUnitId: zone.id });
    }, 600_000);

    it('are Boditi’s for Boditi, and never a sibling’s: the register is regional, the campaign is the caller’s subtree', async () => {
        const at = (unit: OrgUnit, userId: string, campaignId: string) => {
            const ctx = contextFor(unit, userId);
            return app.scoped(ctx, (tx) => new CampaignService().progress(tx, ctx, campaignId, false));
        };
        // Damot Gale reads the zone's campaign (class C), and sees no count and no target of Boditi
        const sibling = await at(damot, id.verifier, bolo.id);
        expect(sibling.campaign.id).toBe(bolo.id);
        expect(sibling.offices.map((o) => o.unit.code)).not.toContain('WOL-BODITI');
        expect(sibling.total).toMatchObject({ today: 0, total: 0 });
        const targets = await app.scoped(contextFor(damot, id.verifier), async (tx) =>
            Number((await tx.execute(sql`select count(*)::int as n from competency.campaign_targets`)).rows[0]?.n)
        );
        expect(targets).toBe(0);

        const own = await at(boditi, id.verifier, bolo.id);
        expect(own.offices.map((o) => o.unit.code)).toEqual(['WOL-BODITI']);
        expect(own.offices[0]).toMatchObject({ today: 2, total: 3, target: { count: 20 } });
        expect(own).toMatchObject({ mayManage: false });
    });

    it('are seen by an office through the campaign of its zone, and its own target only', async () => {
        const list = await api.call('GET', '/api/v1/campaigns', as.verifier);
        expect(list.statusCode, list.body).toBe(200);
        const ids = list.json<CampaignList>().items.map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining([bolo.id, exchange.id]));
        const seen = await progressOf(as.verifier, bolo.id);
        expect(seen.campaign).toMatchObject({ id: bolo.id, unit: { code: 'WOL' } });
        expect(seen.offices.map((o) => o.unit.code)).toEqual(['WOL-BODITI']);
        expect(seen).toMatchObject({ mayManage: false, ownUnitId: boditi.id });
        expect(seen.total).toMatchObject({ today: 2, total: 3, target: 20 });
    });
});

describe('closing a campaign', () => {
    it('is the running unit’s, on its version, and a closed campaign takes no target', async () => {
        const mine = await api.call('POST', `/api/v1/campaigns/${exchange.id}/close`, as.verifier, {}, ifMatch(1));
        expect(mine.statusCode, mine.body).toBe(403);
        expect(
            (await api.call('POST', `/api/v1/campaigns/${exchange.id}/close`, as.zone, {}, ifMatch(9))).statusCode
        ).toBe(409);
        const closed = await api.call('POST', `/api/v1/campaigns/${exchange.id}/close`, as.zone, {}, ifMatch(1));
        expect(closed.statusCode, closed.body).toBe(200);
        expect(closed.json<CampaignProgress>().campaign.closedAt).not.toBeNull();
        expect(await auditOf(requestIdOf(closed))).toMatchObject({ 'competency.campaigns:update': 1 });

        const target = await putTarget(as.zone, exchange.id, { unitId: boditi.id, target: 9 }, ifMatch(1));
        expect(target.statusCode, target.body).toBe(409);
        expect(detailOf('competency.errors.campaign_closed')).toContain(target.json<{ detail?: string }>().detail);
        const again = await api.call('POST', `/api/v1/campaigns/${exchange.id}/close`, as.zone, {}, ifMatch(2));
        expect(again.statusCode).toBe(409);

        // a closed campaign no longer blocks another of its kind in its days
        const next = await create(as.zone, body('plate_exchange'));
        expect(next.statusCode, next.body).toBe(201);
    });
});
