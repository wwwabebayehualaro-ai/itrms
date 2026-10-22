import { defineModule } from '@itrms/module-sdk';

// Work process 1 (service-catalogue.md, DVC-01…11). Task 0.10b declares what the shell needs (permissions, roles, menu);
// the licence slice itself comes in task 0.24.
const LICENSING = ['DVC-03', 'DVC-04', 'DVC-08', 'DVC-10', 'DVC-11'];

export default defineModule({
    key: 'competency',
    layer: 'work-process',
    version: '0.0.0',
    dependsOn: ['kernel'],
    title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver and vehicle competency' },
    workProcess: 1,
    entitlement: 'itrms.licensing',
    permissions: {
        licence: ['read', 'issue', 'print'],
        exam: ['read', 'record']
    },
    roles: {
        'competency.officer': ['licence:read', 'exam:read'],
        'competency.lead': ['licence:read', 'licence:issue', 'licence:print', 'exam:read'],
        'competency.examiner': ['exam:read', 'exam:record'],
        'competency.inspector': ['licence:read']
    },
    services: [
        'DVC-01',
        'DVC-02',
        'DVC-03',
        'DVC-04',
        'DVC-05',
        'DVC-06',
        'DVC-07',
        'DVC-08',
        'DVC-09',
        'DVC-10',
        'DVC-11'
    ],
    menu: [
        {
            key: 'competency.applications',
            group: 'work-process',
            order: 10,
            label: 'competency.nav.applications',
            icon: 'id-card',
            route: '/competency/applications',
            requires: { permission: 'licence:read', services: LICENSING },
            quickActions: [
                {
                    key: 'competency.newApplication',
                    label: 'competency.action.newApplication',
                    route: '/competency/applications/new',
                    requires: { permission: 'licence:read', services: ['DVC-03'] }
                }
            ]
        },
        {
            key: 'competency.exams',
            group: 'work-process',
            order: 20,
            label: 'competency.nav.exams',
            icon: 'clipboard-check',
            route: '/competency/exams',
            requires: { permission: 'exam:read', services: ['DVC-10'], capabilities: ['has_examiners'] }
        },
        {
            key: 'competency.printBatches',
            group: 'work-process',
            order: 30,
            label: 'competency.nav.printBatches',
            icon: 'printer',
            route: '/competency/print-batches',
            requires: { permission: 'licence:print', services: LICENSING, capabilities: ['prints_documents'] }
        }
    ]
});
