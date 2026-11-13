import { defineModule } from '@itrms/module-sdk';

// Work process 1 (service-catalogue.md, DVC-01…11). Task 0.10b declared what the shell needs; task 0.24a adds the licence register,
// its effects and its lookups.
const LICENSING = ['DVC-03', 'DVC-04', 'DVC-08', 'DVC-10', 'DVC-11'];
// the register (roles-and-permissions.md §2): officers register and correct applicants and check their identity
// form:read: a case's request names its applicant and school through registry lookups, which need it to show their names
const REGISTER_READ = ['person:read', 'organisation:read', 'vehicle:read', 'file:upload', 'file:read', 'form:read'];
const REGISTER_INTAKE = [
    ...REGISTER_READ,
    'person:lookup',
    'person:create',
    'person:update',
    'organisation:create',
    'organisation:update'
];

// a case's steps (@itrms/workflow, task 0.19b): which step a role acts on is the workflow's business
const CASE_ACT = ['case:read', 'case:act', 'case:comment'];

export default defineModule({
    key: 'competency',
    layer: 'work-process',
    version: '0.0.0',
    dependsOn: ['kernel', 'integrations', 'forms', 'fees', 'documents', 'workflow', 'services', 'parties', 'vehicles'],
    lookups: ['driver-licence', 'training-school'],
    // what the proclamation sets no figure for (ADR-0047)
    settings: [
        {
            key: 'competency.medical_valid_months',
            default: 6,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        {
            key: 'competency.renewal_window_months',
            default: 6,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        }
    ],
    effects: [
        'competency.checkApplication',
        'competency.recordExam',
        'competency.createPendingLicence',
        'competency.activateLicence',
        'competency.voidPendingLicence',
        'competency.checkRenewal',
        'competency.requestRenewal',
        'competency.renewLicence',
        'competency.issueLicenceCard',
        'competency.addToPrintBatch',
        'competency.checkVehicleRegistration',
        'competency.reserveRegistrationPlate',
        'competency.recordFederalVehicleId',
        'competency.registerVehicle',
        'competency.assignRegistrationPlate',
        'competency.issueLibre',
        'competency.issueLibreBooklet',
        'competency.releaseRegistrationPlate',
        'competency.checkBackCapture',
        'competency.backCaptureVehicle',
        'competency.checkPlateExchange',
        'competency.exchangePlate'
    ],
    title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver and vehicle competency' },
    workProcess: 1,
    entitlement: 'itrms.licensing',
    permissions: {
        licence: ['read', 'issue', 'print'],
        exam: ['read', 'record'],
        training: ['read', 'record']
    },
    roles: {
        'competency.officer': [
            'licence:read',
            'exam:read',
            'training:read',
            'training:record',
            ...REGISTER_INTAKE,
            ...CASE_ACT,
            'pii:reveal',
            'issued-document:read',
            // the office's plate stock, which a registration takes a plate from (tasks 1.2a, 1.2b)
            'plate-stock:read'
        ],
        'competency.lead': [
            'issued-document:read',
            'licence:read',
            'licence:issue',
            'licence:print',
            'exam:read',
            'training:read',
            ...REGISTER_READ,
            ...CASE_ACT,
            'person:lookup',
            'pii:reveal',
            'plate-stock:read'
        ],
        'competency.examiner': ['exam:read', 'exam:record', 'training:read', ...REGISTER_READ, ...CASE_ACT],
        'competency.inspector': ['licence:read', ...REGISTER_READ, 'case:read']
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
        'DVC-11',
        // the plate exchange (Directive 1050/2025): the plates part of DVC-01, its own service
        'DVC-12',
        // the back-capture of paper vehicle files (ADR-0054): the migration's own service, beside the bureau's
        'MIG-01'
    ],
    // a registration takes its plate from the office's own stock (task 1.2b): an office without one doesn't offer it
    capabilitiesRequired: { 'DVC-01': ['holds_plate_stock'], 'DVC-12': ['holds_plate_stock'] },
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
                    requires: { permission: 'case:create', services: ['DVC-03'] }
                }
            ]
        },
        {
            key: 'competency.vehicleRegistrations',
            group: 'work-process',
            order: 12,
            label: 'competency.nav.vehicleRegistrations',
            icon: 'car',
            route: '/competency/vehicle-registrations',
            requires: { permission: 'vehicle:read', services: ['DVC-01'] },
            quickActions: [
                {
                    key: 'competency.newVehicleRegistration',
                    label: 'competency.action.newVehicleRegistration',
                    route: '/competency/vehicle-registrations/new',
                    requires: { permission: 'case:create', services: ['DVC-01'] }
                }
            ]
        },
        {
            key: 'competency.backCaptures',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.backCaptures',
            icon: 'archive',
            route: '/competency/back-captures',
            requires: { permission: 'vehicle:read', services: ['MIG-01'] },
            quickActions: [
                {
                    key: 'competency.newBackCapture',
                    label: 'competency.action.newBackCapture',
                    route: '/competency/back-captures/new',
                    requires: { permission: 'case:create', services: ['MIG-01'] }
                }
            ]
        },
        {
            key: 'competency.plateExchanges',
            group: 'work-process',
            order: 14,
            label: 'competency.nav.plateExchanges',
            icon: 'replace',
            route: '/competency/plate-exchanges',
            requires: { permission: 'vehicle:read', services: ['DVC-12'] },
            quickActions: [
                {
                    key: 'competency.newPlateExchange',
                    label: 'competency.action.newPlateExchange',
                    route: '/competency/plate-exchanges/new',
                    requires: { permission: 'case:create', services: ['DVC-12'] }
                }
            ]
        },
        {
            key: 'competency.bolos',
            group: 'work-process',
            order: 16,
            label: 'competency.nav.bolos',
            icon: 'clipboard-check',
            route: '/competency/bolos',
            requires: { permission: 'vehicle:read', services: ['DVC-02'] },
            quickActions: [
                {
                    key: 'competency.newBolo',
                    label: 'competency.action.newBolo',
                    route: '/competency/bolos/new',
                    requires: { permission: 'case:create', services: ['DVC-02'] }
                }
            ]
        },
        {
            key: 'competency.licences',
            group: 'work-process',
            order: 15,
            label: 'competency.nav.licences',
            icon: 'id-card',
            route: '/competency/licences',
            requires: { permission: 'licence:read', services: LICENSING }
        },
        {
            key: 'competency.training',
            group: 'work-process',
            order: 18,
            label: 'competency.nav.training',
            icon: 'list-checks',
            route: '/competency/training',
            requires: { permission: 'training:read', services: LICENSING }
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
