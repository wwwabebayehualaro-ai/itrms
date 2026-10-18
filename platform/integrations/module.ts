import { defineModule } from '@itrms/module-sdk';

export default defineModule({
    key: 'integrations',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel']
});
