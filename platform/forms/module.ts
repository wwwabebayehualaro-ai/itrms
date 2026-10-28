import { defineModule } from '@itrms/module-sdk';

// Form definitions, versions and submissions (form-platform.md, task 0.16a). The cross-cutting roles get these permissions
// in the kernel's manifest (only the kernel defines them). Publishing is maker-checker (SEC-AC-6): one person asks with
// `form:publish`, another with `form:approve` decides.
export default defineModule({
    key: 'forms',
    layer: 'platform',
    version: '0.0.0',
    dependsOn: ['kernel'],
    title: { am: 'ቅጾች', en: 'Forms' },
    permissions: {
        form: ['read', 'create', 'update', 'publish', 'approve'],
        // export: leaving the system with data is a right of its own (roles-and-permissions.md §2 `export`)
        submission: ['read', 'create', 'update', 'export'],
        // share: a saved view for the whole office, or the office's default view
        'submission-view': ['share']
    },
    // the worker fills the values of newly filterable fields when a version is published (ADR-0035)
    // and makes the background exports asked for (task 0.16e)
    events: {
        emits: ['form.published.v1', 'submission-export.requested.v1'],
        consumes: ['form.published.v1', 'submission-export.requested.v1']
    },
    // the publications waiting for the person's decision (maker-checker), with their count as a badge (task 0.20d)
    menu: [
        {
            key: 'forms.approvals',
            group: 'my-work',
            order: 20,
            label: 'forms.nav.approvals',
            icon: 'badge-check',
            route: '/approvals',
            requires: { permission: 'form:approve' }
        }
    ]
});
