import { defineModule } from '@itrms/module-sdk';

// Workflow definitions (architecture.md §8, task 0.19a); cases and transitions follow in 0.19b. The cross-cutting roles get
// these permissions in the kernel's manifest. A definition names step forms, so the slice reads forms' versions.
export default defineModule({
    key: 'workflow',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms'],
    title: { am: 'የሥራ ፍሰት', en: 'Workflow' },
    permissions: {
        'workflow-definition': ['read', 'create', 'update']
    }
});
