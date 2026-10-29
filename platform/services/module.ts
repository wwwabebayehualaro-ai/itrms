import { defineModule } from '@itrms/module-sdk';

// The service catalogue, its versions and the units' overrides, and requests started as cases (architecture.md §6.2, §7;
// task 0.21b). Its permissions are the kernel's (`service-config:read|update`, `case:create`): only the kernel defines
// the cross-cutting roles' rights. A version names form and workflow versions, so the slice reads both.
export default defineModule({
    key: 'services',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms', 'workflow'],
    title: { am: 'አገልግሎቶች', en: 'Services' }
});
