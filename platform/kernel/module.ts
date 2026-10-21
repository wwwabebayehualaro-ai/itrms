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
    }
});
