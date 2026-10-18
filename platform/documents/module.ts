import { defineModule } from '@itrms/module-sdk';

export default defineModule({
    key: 'documents',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel']
});
