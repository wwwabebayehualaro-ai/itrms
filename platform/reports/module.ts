import { defineModule } from '@itrms/module-sdk';

export default defineModule({
    key: 'reports',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel']
});
