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
    // the SLA timers are its own: the worker marks an overdue step and delivers a wait's timeout (0.20a)
    events: {
        emits: ['case.transitioned.v1', 'case-task.due.v1', 'case.wait-due.v1'],
        consumes: ['case-task.due.v1', 'case.wait-due.v1']
    }
});
