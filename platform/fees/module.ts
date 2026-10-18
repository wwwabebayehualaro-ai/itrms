import { defineModule } from '@itrms/module-sdk';

export default defineModule({
    key: 'fees',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel']
});
