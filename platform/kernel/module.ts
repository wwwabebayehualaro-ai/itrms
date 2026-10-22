import { defineModule } from '@itrms/module-sdk';

// The kernel's permissions and the cross-cutting roles (roles-and-permissions.md §1–2). Work-process roles
// (`competency.officer` …) are their modules'. Sensitive resources (role assignments, service configuration, the audit
// log) are always named one by one, never granted by a wildcard.
const READ_ORG = ['org-unit:read', 'service-config:read'];

export default defineModule({
    key: 'kernel',
    layer: 'kernel',
    version: '0.0.0',
    dependsOn: [],
    permissions: {
        'org-unit': ['read', 'create', 'update', 'move', 'deactivate'],
        'service-config': ['read', 'update'],
        'role-assignment': ['read', 'grant', 'revoke'],
        'audit-log': ['read']
    },
    roles: {
        bureau_admin: [
            ...READ_ORG,
            'org-unit:create',
            'org-unit:update',
            'org-unit:move',
            'org-unit:deactivate',
            'service-config:update',
            'role-assignment:read',
            'role-assignment:grant',
            'role-assignment:revoke',
            'audit-log:read'
        ],
        unit_admin: [
            ...READ_ORG,
            'org-unit:update',
            'service-config:update',
            'role-assignment:read',
            'role-assignment:grant',
            'role-assignment:revoke',
            'audit-log:read'
        ],
        unit_head: [...READ_ORG, 'role-assignment:read', 'audit-log:read'],
        records_officer: READ_ORG,
        cashier: READ_ORG,
        finance_officer: READ_ORG,
        auditor: [...READ_ORG, 'role-assignment:read', 'audit-log:read'],
        viewer: READ_ORG
    },
    // the installation's languages (i18n-and-languages.md): Amharic and English everywhere; a region adds its own
    // (Wolaita: wal-Latn) as an override, with the configuration inheritance of task 0.21
    settings: [{ key: 'i18n.languages', default: ['am', 'en'] }],
    // the platform's own entries; work processes, registries and reports bring theirs (navigation-and-menus.md §3)
    menu: [{ key: 'kernel.home', group: 'home', order: 0, label: 'kernel.nav.home', icon: 'house', route: '/' }]
});
