import { defineModule } from '@itrms/module-sdk';

// The register of people and organisations (architecture.md §8, task 0.14): regional records, read across the region,
// written by the unit that handles them. The cross-cutting roles get these permissions in the kernel's manifest (only the
// kernel defines them); work-process roles get them from their own modules. A merge needs a second person's approval
// (SEC-AC-6); the sensitive fields are read in clear only with the kernel's `pii:reveal`.
export default defineModule({
    key: 'parties',
    layer: 'registry',
    version: '0.0.0',
    dependsOn: ['kernel'],
    title: { am: 'የሰዎችና የድርጅቶች መዝገብ', en: 'People and organisations' },
    permissions: {
        // lookup: find a person by an exact FIN or phone (intake only; each one is audited)
        person: ['read', 'lookup', 'create', 'update', 'merge', 'approve-merge'],
        organisation: ['read', 'create', 'update']
    },
    events: { emits: ['person.merged.v1'], consumes: [] },
    menu: [
        {
            key: 'parties.persons',
            group: 'registries',
            order: 10,
            label: 'parties.nav.persons',
            icon: 'users',
            route: '/registry/persons',
            requires: { permission: 'person:read' },
            quickActions: [
                {
                    key: 'parties.newPerson',
                    label: 'parties.action.newPerson',
                    route: '/registry/persons/new',
                    requires: { permission: 'person:create' }
                }
            ]
        },
        {
            key: 'parties.organisations',
            group: 'registries',
            order: 20,
            label: 'parties.nav.organisations',
            icon: 'building-2',
            route: '/registry/organisations',
            requires: { permission: 'organisation:read' }
        },
        {
            key: 'parties.merges',
            group: 'registries',
            order: 30,
            label: 'parties.nav.merges',
            icon: 'git-merge',
            route: '/registry/merges',
            requires: { permission: 'person:approve-merge' }
        }
    ]
});
