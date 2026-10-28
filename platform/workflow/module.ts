import { defineModule } from '@itrms/module-sdk';

// Workflow definitions (architecture.md §8, task 0.19a), cases and transitions (0.19b), SLA timers (0.20a), the inbox, the
// case page and comments (0.20b). The cross-cutting roles get these permissions in the kernel's manifest. A definition
// names step forms, so the slice reads forms' versions.
export default defineModule({
    key: 'workflow',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel', 'forms'],
    title: { am: 'የሥራ ፍሰት', en: 'Workflow' },
    permissions: {
        'workflow-definition': ['read', 'create', 'update'],
        // a case's steps: who acts on one is the engine's business (the step's role in its unit); `act` lets a role try
        // (and take a step on); `create` is intake; `comment` writes on the timeline and mentions colleagues
        case: ['read', 'create', 'act', 'comment']
    },
    // the SLA timers are its own: the worker marks an overdue step and delivers a wait's timeout (0.20a); a comment's
    // mentions are told by the worker (0.20b)
    events: {
        emits: ['case.transitioned.v1', 'case-task.due.v1', 'case.wait-due.v1', 'case.commented.v1'],
        consumes: ['case-task.due.v1', 'case.wait-due.v1', 'case.commented.v1']
    },
    menu: [
        {
            key: 'workflow.inbox',
            group: 'my-work',
            order: 10,
            label: 'workflow.nav.inbox',
            icon: 'inbox',
            route: '/inbox',
            requires: { permission: 'case:act' }
        }
    ]
});
