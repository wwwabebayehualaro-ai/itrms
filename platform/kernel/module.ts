import { defineModule } from '@itrms/module-sdk';

// The kernel's permissions and the cross-cutting roles (roles-and-permissions.md §1–2). Work-process roles
// (`competency.officer` …) are their modules'. Sensitive resources (role assignments, service configuration, the audit
// log) are always named one by one, never granted by a wildcard.
// every office uploads and reads its own files (task 0.15): the scope is the unit's subtree (RLS); and reads the forms it
// fills in (its own, its subtree's and those of the offices above, task 0.16a)
const READ_ORG = ['org-unit:read', 'service-config:read', 'file:upload', 'file:read', 'form:read'];
// the register of people and organisations (@itrms/parties, roles-and-permissions.md §2): every office reads it; intake
// (records officers) registers and corrects, and asks for merges; a unit head approves them
const REGISTER = ['person:read', 'organisation:read'];
const INTAKE = [
    ...REGISTER,
    'person:lookup',
    'person:create',
    'person:update',
    'person:merge',
    'organisation:create',
    'organisation:update'
];
// forms (@itrms/forms, task 0.16a): the bureau and unit administrators author them; a second person approves a
// publication (SEC-AC-6). Submissions follow the `case` column of roles-and-permissions.md §2 until cases exist (0.19).
const AUTHOR_FORMS = ['form:create', 'form:update', 'form:publish'];
// workflow definitions (@itrms/workflow, task 0.19a): authored by the same administrators as forms; a version stored is
// not live until a service version names it (0.21)
const AUTHOR_WORKFLOWS = ['workflow-definition:read', 'workflow-definition:create', 'workflow-definition:update'];
// cases (@itrms/workflow, task 0.19b; roles-and-permissions.md §2 `case`): who acts on a step is the engine's business (the
// step's role in its unit); `case:act` lets the operational roles try, and comment on the timeline (0.20b); intake starts
// cases (`case:create`)
const CASE_READ = ['case:read'];
const CASE_ACT = ['case:read', 'case:act', 'case:comment'];

export default defineModule({
    key: 'kernel',
    layer: 'kernel',
    version: '0.0.0',
    dependsOn: [],
    permissions: {
        'org-unit': ['read', 'create', 'update', 'move', 'deactivate'],
        'service-config': ['read', 'update'],
        'role-assignment': ['read', 'grant', 'revoke'],
        'audit-log': ['read'],
        // the outbox's events and jobs: the dead-letter list, sending a dead event back
        job: ['read', 'retry'],
        // the region's settings (its languages)
        setting: ['update'],
        // sensitive personal fields in clear (Fayda FIN, phone, full birth date), with a reason, audited (task 0.14)
        pii: ['reveal'],
        // uploaded files (scans, photos): upload and confirm, read and download within the unit's subtree
        file: ['upload', 'read']
    },
    roles: {
        bureau_admin: [
            ...READ_ORG,
            ...REGISTER,
            'org-unit:create',
            'org-unit:update',
            'org-unit:move',
            'org-unit:deactivate',
            'service-config:update',
            'role-assignment:read',
            'role-assignment:grant',
            'role-assignment:revoke',
            'audit-log:read',
            'job:read',
            'job:retry',
            'setting:update',
            ...AUTHOR_FORMS,
            ...AUTHOR_WORKFLOWS,
            'form:approve',
            'submission:read',
            'submission:export',
            'submission-view:share',
            ...CASE_READ
        ],
        unit_admin: [
            ...READ_ORG,
            ...REGISTER,
            'org-unit:update',
            'service-config:update',
            'role-assignment:read',
            'role-assignment:grant',
            'role-assignment:revoke',
            'audit-log:read',
            ...AUTHOR_FORMS,
            ...AUTHOR_WORKFLOWS
        ],
        unit_head: [
            ...READ_ORG,
            ...REGISTER,
            'role-assignment:read',
            'audit-log:read',
            'pii:reveal',
            'person:lookup',
            'person:approve-merge',
            'form:approve',
            'submission:read',
            'submission:export',
            'submission-view:share',
            ...CASE_ACT
        ],
        // at intake: checks the identity of the person in front of them
        records_officer: [
            ...READ_ORG,
            ...INTAKE,
            ...CASE_ACT,
            'case:create',
            'pii:reveal',
            'submission:create',
            'submission:read'
        ],
        cashier: [...READ_ORG, ...REGISTER, ...CASE_ACT, 'submission:read'],
        finance_officer: [...READ_ORG, ...REGISTER, ...CASE_ACT, 'submission:read', 'submission:export'],
        auditor: [
            ...READ_ORG,
            ...REGISTER,
            'role-assignment:read',
            'audit-log:read',
            'workflow-definition:read',
            'submission:read',
            'submission:export',
            ...CASE_READ
        ],
        // names and addresses only: never a sensitive field (no pii:reveal)
        viewer: [...READ_ORG, ...REGISTER]
    },
    // the installation's languages (i18n-and-languages.md): Amharic and English everywhere; a region adds its own
    // (Wolaita: wal-Latn) as an override, with the configuration inheritance of task 0.21
    settings: [{ key: 'i18n.languages', default: ['am', 'en'], overridableAt: ['region'] }],
    // the identity provider follows the tree and the assignments through the outbox (the worker's identity sync)
    events: {
        emits: ['org-unit.changed.v1', 'role-assignment.changed.v1'],
        consumes: ['org-unit.changed.v1', 'role-assignment.changed.v1']
    },
    // the platform's own entries; work processes, registries and reports bring theirs (navigation-and-menus.md §3)
    menu: [
        { key: 'kernel.home', group: 'home', order: 0, label: 'kernel.nav.home', icon: 'house', route: '/' },
        {
            key: 'kernel.languages',
            group: 'administration',
            order: 10,
            label: 'kernel.nav.languages',
            icon: 'languages',
            route: '/admin/languages',
            requires: { permission: 'setting:update' }
        }
    ]
});
