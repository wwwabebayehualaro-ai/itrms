import { defineModule } from '@itrms/module-sdk';

import { DEFAULT_ENCUMBRANCE_BLOCKS, ENCUMBRANCE_BLOCKS_SETTING, ENCUMBRANCE_EFFECTS } from './contracts/encumbrances';
import { DEFAULT_LEGACY_PLATE_REGIONS } from './contracts/plate';

// The vehicle register (architecture.md §6.1, task 1.1a): regional records, read across the region, changed by the unit
// that handles the vehicle and only through a case (roles-and-permissions.md §2). The cross-cutting roles get `vehicle:read`
// in the kernel's manifest and the work-process roles from their own modules.
export default defineModule({
    key: 'vehicles',
    layer: 'registry',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms', 'parties'],
    lookups: ['vehicle'],
    // the old regional plates' codes, Latin and Ethiopic: a region corrects them to its own records
    settings: [
        {
            key: 'vehicles.legacy_plate_regions',
            default: DEFAULT_LEGACY_PLATE_REGIONS.map((r) => ({ code: r.code, aliases: [...r.aliases] })),
            overridableAt: ['installation', 'region']
        },
        // which holds block which conflicting service (task 1.4a): a region may be stricter or looser than the shipped matrix
        {
            key: ENCUMBRANCE_BLOCKS_SETTING,
            default: Object.fromEntries(Object.entries(DEFAULT_ENCUMBRANCE_BLOCKS).map(([k, v]) => [k, [...v]])),
            overridableAt: ['installation', 'region']
        }
    ],
    // the check a service's workflow names on filing, before its payment order and before the step that gives the result
    effects: [ENCUMBRANCE_EFFECTS.checkEncumbrances],
    title: { am: 'የተሽከርካሪ መዝገብ', en: 'Vehicle register' },
    permissions: {
        vehicle: ['read'],
        // the plate stock (task 1.2a): its keepers receive, hand down, accept and write off; unit heads and auditors read it
        'plate-stock': ['read', 'receive', 'allocate', 'write-off'],
        // holds on a vehicle (task 1.4a): recorded and released by the office that acts for the holder, a second person confirms
        encumbrance: ['read', 'record', 'release']
    },
    menu: [
        {
            key: 'vehicles.vehicles',
            group: 'registries',
            order: 15,
            label: 'vehicles.nav.vehicles',
            icon: 'car',
            route: '/registry/vehicles',
            requires: { permission: 'vehicle:read' }
        },
        {
            key: 'vehicles.plateStock',
            group: 'registries',
            order: 16,
            label: 'vehicles.nav.plateStock',
            icon: 'package',
            route: '/registry/plate-stock',
            requires: { permission: 'plate-stock:read', capabilities: ['holds_plate_stock'] }
        },
        {
            key: 'vehicles.encumbrances',
            group: 'registries',
            order: 17,
            label: 'vehicles.nav.encumbrances',
            icon: 'lock',
            route: '/registry/encumbrances',
            requires: { permission: 'encumbrance:read' }
        }
    ]
});
