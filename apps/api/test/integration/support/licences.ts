/**
 * The region settings the licence suites run under (task 1.6): how a region numbers its licences and whether it collects the
 * blood group. Written straight into the table as a bureau's screen would leave them (the settings screen's own path is
 * settings.int.spec's); the counters are then set up from them as `seed competency` does.
 */
import type { LicenceNumbering } from '@itrms/competency/contracts';

import type { TestApi } from './api';

/** The suites' region: South Ethiopia's code and a range from 1 (placeholders, Z). */
export const REGIONAL_NUMBERING: LicenceNumbering = { scope: 'region', regionCode: '06', firstNumber: 1 };

/** A region's own value of a setting (its root unit's), replacing any it had. */
export async function setRegionSetting(
    api: Pick<TestApi, 'owner'>,
    root: { id: string; regionId: string },
    key: string,
    value: unknown
): Promise<void> {
    await api.owner.query(
        'delete from kernel.settings_values where unit_id = $1 and unit_type_id is null and key = $2',
        [root.id, key]
    );
    await api.owner.query(
        `insert into kernel.settings_values (id, region_id, unit_id, key, value)
         values (gen_random_uuid(), $1, $2, $3, $4::jsonb)`,
        [root.regionId, root.id, key, JSON.stringify(value)]
    );
}

export const setLicenceNumbering = (
    api: Pick<TestApi, 'owner'>,
    root: { id: string; regionId: string },
    numbering: LicenceNumbering = REGIONAL_NUMBERING
) => setRegionSetting(api, root, 'competency.licence_number', numbering);
