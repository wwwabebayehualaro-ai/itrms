/**
 * The service catalogue (task 0.21b) and the codes that name its services elsewhere: every service a module serves, and
 * every service a unit type of the seeds offers, is one of the catalogue's; the catalogue has the reference design's 54, and
 * the migration's own back-capture of paper vehicle files (MIG-01, task 1.13) the plate exchange (DVC-12, task 1.2c) and the ownership transfer (DVC-13, task 1.4b).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandServiceCodes, parseOrgYaml } from '@itrms/kernel/org';
import { parseCatalogue } from '@itrms/services/seed';
import { describe, expect, it } from 'vitest';

import { SLICES } from './slices';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const catalogue = parseCatalogue(readFileSync(join(ROOT, 'platform', 'services', 'seed', 'catalogue.yaml'), 'utf8'));
const codes = new Set(catalogue.map((s) => s.code));

describe('the service catalogue', () => {
    it('has the 54 services of the reference design, the plate exchange, the ownership transfer, the transfer out and in, the cancellation of a release, the back-captures, the licence replacement and the licence suspension record, each code once, in Amharic and English', () => {
        expect(catalogue).toHaveLength(64);
        expect(codes.size).toBe(64);
        // the migration's own: paper vehicle files (task 1.13) and paper driver licences (task 1.6b)
        expect(catalogue.filter((s) => s.code.startsWith('MIG-')).map((s) => s.code)).toEqual(['MIG-01', 'MIG-02']);
        for (const s of catalogue) expect(s.name.am && s.name.en).toBeTruthy();
    });

    it('has every service a module serves and every service a seeded unit type offers', () => {
        const served = SLICES.flatMap((s) => s.manifest.services);
        expect(served.filter((c) => !codes.has(c))).toEqual([]);
        for (const file of [
            join(ROOT, 'apps', 'api', 'seed', 'org', 'south-ethiopia.wolaita.yaml'),
            join(ROOT, 'apps', 'api', 'test', 'fixtures', 'org', 'test-zone-b.yaml'),
            join(ROOT, 'apps', 'api', 'test', 'fixtures', 'org', 'region-without-zones.yaml')
        ]) {
            const offered = (parseOrgYaml(readFileSync(file, 'utf8')).unitTypes ?? []).flatMap((t) =>
                expandServiceCodes(t.services ?? [])
            );
            expect(
                offered.filter((c) => !codes.has(c)),
                file
            ).toEqual([]);
        }
    });
});
