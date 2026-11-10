import { defineModule } from '@itrms/module-sdk';

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
        }
    ],
    title: { am: 'የተሽከርካሪ መዝገብ', en: 'Vehicle register' },
    permissions: {
        vehicle: ['read']
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
        }
    ]
});
