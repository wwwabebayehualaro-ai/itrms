/**
 * The regional licence counter under load (task 1.6, ADR-0051 §5): one counter row for the whole region is a lock hotspot, held
 * only for the activation's transaction. 200 activations across two offices, ten at a time, each in its own system transaction as
 * the worker delivers them: every one is numbered once, the sequence has no gap, and the activation's p95 stays within the
 * command budget (docs/engineering/nfr.md: commands p95 < 800 ms).
 *   pnpm --filter @itrms/api test:perf
 */
import { randomUUID } from 'node:crypto';

import { LicencesService } from '@itrms/competency/api';
import { setUpLicenceCounters } from '@itrms/competency/seed';
import { createSystemDatabase, type SystemDatabase } from '@itrms/kernel/db/system';
import type { OrgUnit } from '@itrms/kernel/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startApi, type TestApi } from '../integration/support/api';
import { setLicenceNumbering } from '../integration/support/licences';
import { startPostgres, type TestPostgres } from '../integration/support/postgres';

const ACTIVATIONS = Number(process.env.PERF_ACTIVATIONS ?? 200);
const AT_ONCE = 10;
const BUDGET_MS = 800;

let pg: TestPostgres;
let api: TestApi;
let system: SystemDatabase;
let licences: LicencesService;
let offices: OrgUnit[];
let person: string;

beforeAll(async () => {
    pg = await startPostgres();
    api = await startApi(pg);
    system = createSystemDatabase(pg.url('system'), { onUse: () => undefined });
    licences = api.http.get(LicencesService);
    const region = await api.unit('SER', 'SER');
    offices = [await api.unit('SER', 'WOL-BODITI'), await api.unit('SER', 'WOL')];
    await setLicenceNumbering(api, { id: region.id, regionId: region.regionId });
    await api.installer.scoped({}, (tx) => setUpLicenceCounters(tx, region.regionId));
    const res = await api.call(
        'POST',
        '/api/v1/persons',
        { sub: '0199f0a0-d000-7000-8000-000000000302', unit: offices[0] as OrgUnit },
        {
            nameAm: { given: 'ጭነት', father: 'ፈተና' },
            nameEn: { given: 'Load', father: 'Test' },
            sex: 'male',
            birthYear: 1990,
            acknowledgedDuplicates: []
        }
    );
    expect(res.statusCode, res.body).toBe(201);
    person = res.json<{ id: string }>().id;
}, 240_000);

afterAll(async () => {
    await system?.close();
    await api?.close();
    await pg?.stop();
});

const p95 = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

describe('the regional licence counter (ADR-0051 §5)', () => {
    it(`numbers ${ACTIVATIONS} activations, ${AT_ONCE} at a time, with no gap, within the command p95`, async () => {
        const pending: { id: string; unit: OrgUnit }[] = [];
        for (let i = 0; i < ACTIVATIONS; i += 1) {
            const unit = offices[i % offices.length] as OrgUnit;
            const { rows } = await api.owner.query<{ id: string }>(
                `insert into competency.driver_licences (id, region_id, handling_unit_id, person_id)
                 values (gen_random_uuid(), $1, $2, $3) returning id`,
                [unit.regionId, unit.id, person]
            );
            pending.push({ id: rows[0]?.id ?? '', unit });
        }
        const timings: number[] = [];
        const numbers: string[] = [];
        for (let i = 0; i < pending.length; i += AT_ONCE)
            await Promise.all(
                pending.slice(i, i + AT_ONCE).map(async ({ id, unit }) => {
                    const from = performance.now();
                    const given = await system.systemContext('perf.activate', (tx) =>
                        licences.activate(
                            tx,
                            {
                                caseId: randomUUID(),
                                regionId: unit.regionId,
                                handlingUnitId: unit.id,
                                ctx: { requestId: 'perf' }
                            },
                            { licence: { id } },
                            { reference: `PERF-${id}` }
                        )
                    );
                    timings.push(performance.now() - from);
                    numbers.push(given.licence.number ?? '');
                })
            );
        const took = p95(timings);
        console.warn(
            `licence activation: ${ACTIVATIONS} in batches of ${AT_ONCE}, p95 ${took.toFixed(1)} ms, max ${Math.max(...timings).toFixed(1)} ms (budget ${BUDGET_MS} ms)`
        );
        expect(numbers.sort()).toEqual(
            Array.from({ length: ACTIVATIONS }, (_, i) => `06-${String(i + 1).padStart(5, '0')}`)
        );
        expect(took).toBeLessThan(BUDGET_MS);
    }, 600_000);
});
