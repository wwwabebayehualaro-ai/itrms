import { defineModule } from '@itrms/module-sdk';

// The service catalogue, its versions and the units' overrides, and requests started as cases (architecture.md §6.2, §7;
// task 0.21b). Its permissions are the kernel's (`service-config:read|update`, `case:create`): only the kernel defines
// the cross-cutting roles' rights. A version names form and workflow versions, so the slice reads both.
export default defineModule({
    key: 'services',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms', 'workflow'],
    title: { am: 'አገልግሎቶች', en: 'Services' },
    // a request at the counter (intake), and the catalogue with its versions and overrides (task 0.21c)
    menu: [
        {
            key: 'services.request',
            group: 'my-work',
            order: 5,
            label: 'services.nav.request',
            icon: 'file-plus',
            route: '/requests/new',
            requires: { permission: 'case:create' }
        },
        {
            key: 'services.catalogue',
            group: 'administration',
            order: 20,
            label: 'services.nav.catalogue',
            icon: 'list-checks',
            route: '/services',
            requires: { permission: 'service-config:update' }
        }
    ]
});
