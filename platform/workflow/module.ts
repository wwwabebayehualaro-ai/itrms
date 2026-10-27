import { defineModule } from '@itrms/module-sdk';

// Workflow definitions (architecture.md §8, task 0.19a), cases and transitions (0.19b). The cross-cutting roles get
// these permissions in the kernel's manifest. A definition names step forms, so the slice reads forms' versions.
export default defineModule({
    key: 'workflow',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms'],
    title: { am: 'የሥራ ፍሰት', en: 'Workflow' },
    permissions: {
        'workflow-definition': ['read', 'create', 'update'],
        // a case's steps: who acts on one is the engine's business (the step's role in its unit); `act` lets a role try
        case: ['read', 'act']
    },
    events: { emits: ['case.transitioned.v1'], consumes: [] }
});
