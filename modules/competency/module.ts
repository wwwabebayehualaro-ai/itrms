import { defineModule } from '@itrms/module-sdk';

// Work process 1 (service-catalogue.md, DVC-01…13). Task 0.10b declared what the shell needs; task 0.24a adds the licence register,
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
    lookups: ['driver-licence', 'training-school', 'garage', 'office'],
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
        },
        // a temporary bolo's days, and how long before a bolo's last day its owners are reminded (task 1.3b)
        {
            key: 'competency.bolo_temporary_days',
            default: 30,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        {
            key: 'competency.bolo_reminder_days',
            default: 30,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        // the share of each clerk's migrated records re-checked against the scan, in percent (task 1.13g, ADR-0054 §3); the
        // default is to agree with the zone. Never an office's own: the office measured does not set its own measure
        {
            key: 'competency.migration_sample_percent',
            default: 5,
            overridableAt: ['installation', 'region', 'unitType']
        },
        // how many days a letter of an ownership transfer stands (task 1.4b); a stated assumption until the zone says
        {
            key: 'competency.transfer_letter_valid_days',
            default: 30,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        // whether the papers that come back must be dated while their letter stood (task 1.4b3): strict unless the region
        // turns it off; an office does not relax a rule it is held to
        {
            key: 'competency.transfer_letter_validity_enforced',
            default: true,
            overridableAt: ['installation', 'region'],
            // turning it off relaxes a control: a change needs a fresh second factor (SEC-SE-5)
            sensitive: true
        },
        // how long a vehicle released to another office stands for it (task 1.4c, ADR-0057: the zone's document, 15 days)
        {
            key: 'competency.vehicle_transfer_valid_days',
            default: 15,
            overridableAt: ['installation', 'region']
        },
        // whether the receiving office inspects the vehicle again before it receives it (no, until the zone says)
        {
            key: 'competency.vehicle_transfer_reinspect',
            default: false,
            overridableAt: ['installation', 'region'],
            // turning it off drops a control: a change needs a fresh second factor (SEC-SE-5)
            sensitive: true
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
        'competency.exchangePlate',
        'competency.checkOwnershipTransfer',
        'competency.recordValuation',
        'competency.issueTransferLetters',
        'competency.recordTransferEvidence',
        'competency.transferOwnership',
        'competency.revokeTransferLetters',
        'competency.checkTransferOut',
        'competency.releaseVehicle',
        'competency.checkTransferIn',
        'competency.recordTransferInspection',
        'competency.receiveVehicle',
        'competency.checkBolo',
        'competency.recordBoloInspection',
        'competency.issueBoloSticker',
        'competency.issueTemporaryBolo',
        'competency.voidBolo',
        'competency.recordBoloRepair'
    ],
    title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver and vehicle competency' },
    workProcess: 1,
    entitlement: 'itrms.licensing',
    permissions: {
        licence: ['read', 'issue', 'print'],
        exam: ['read', 'record'],
        training: ['read', 'record'],
        // the bulk import of paper vehicle files (task 1.13b): a sheet sent, and committed by a second person
        'vehicle-import': ['read', 'create', 'commit'],
        // sampling QA of migrated records (task 1.13g): the drawn records read, and re-checked by a third person
        'migration-sample': ['read', 'recheck'],
        // the reconciliation report (task 1.13h): paper files counted against the vehicles migrated; counted by the zone above
        'migration-report': ['read', 'count'],
        // campaign counters (task 1.13i): each office's daily count against the target its unit above set; run by the unit above
        campaign: ['read', 'manage']
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
            'issued-document:read-case',
            // the office's plate stock, which a registration takes a plate from (tasks 1.2a, 1.2b)
            'plate-stock:read',
            // the holds on vehicles the office records and releases for their holders (task 1.4a)
            'encumbrance:read',
            'encumbrance:record',
            'encumbrance:release',
            // a sheet of paper files sent, or another's committed (never one's own, SEC-AC-6), task 1.13b
            'vehicle-import:read',
            'vehicle-import:create',
            'vehicle-import:commit',
            // a migrated record drawn for a re-check, never one's own capture or verification (task 1.13g)
            'migration-sample:read',
            'migration-sample:recheck',
            'migration-report:read',
            'migration-report:count',
            'campaign:read',
            'campaign:manage'
        ],
        'competency.lead': [
            'issued-document:read',
            'issued-document:read-case',
            'licence:read',
            'licence:issue',
            'licence:print',
            'exam:read',
            'training:read',
            ...REGISTER_READ,
            ...CASE_ACT,
            'person:lookup',
            'pii:reveal',
            'plate-stock:read',
            'encumbrance:read',
            'encumbrance:record',
            'encumbrance:release',
            'vehicle-import:read',
            'vehicle-import:commit',
            'migration-sample:read',
            'migration-sample:recheck',
            'migration-report:read',
            'migration-report:count',
            'campaign:read',
            'campaign:manage'
        ],
        'competency.examiner': ['exam:read', 'exam:record', 'training:read', ...REGISTER_READ, ...CASE_ACT],
        // the inspector also acts on the steps of a case it is assigned (the bolo's inspection, the valuation of a transfer) and
        // reads the documents of the cases it works on, not the office's (ADR-0055; the region may widen it)
        'competency.inspector': [
            'licence:read',
            ...REGISTER_READ,
            ...CASE_ACT,
            'issued-document:read-case',
            'campaign:read',
            'encumbrance:read'
        ]
    },
    // what its services number from, set up at an office when it is given the service (task 1.4b4, ADR-0056)
    numberSequences: [
        { key: 'licence', pattern: '{unit}/DL/{seq:06}' },
        { key: 'temporary-bolo', pattern: '{unit}/TB/{seq:05}' },
        { key: 'transfer-letter', pattern: '{unit}/OT/{seq:05}/{efy}' }
    ],
    countersRequired: {
        'DVC-01': ['vehicles.registration-certificate'],
        'DVC-02': ['competency.temporary-bolo'],
        'DVC-03': ['competency.licence'],
        'DVC-13': ['vehicles.registration-certificate', 'competency.transfer-letter']
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
        // the change of a vehicle's owner (task 1.4b): not in the source list, priced by the zone's fee sheet
        'DVC-13',
        // a vehicle leaving one office and entering another of the region (task 1.4c, ADR-0057)
        'DVC-14',
        'DVC-15',
        // the back-capture of paper vehicle files (ADR-0054): the migration's own service, beside the bureau's
        'MIG-01'
    ],
    // a registration takes its plate from the office's own stock (task 1.2b): an office without one doesn't offer it
    // the transfer issues a libre, from the office's stationery (booklets)
    capabilitiesRequired: {
        'DVC-01': ['holds_plate_stock'],
        'DVC-12': ['holds_plate_stock'],
        'DVC-13': ['holds_stationery'],
        // the vehicle's stock plate joins the receiving office's stock (task 1.4c)
        'DVC-15': ['holds_plate_stock']
    },
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
            key: 'competency.vehicleImports',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.vehicleImports',
            icon: 'file-spreadsheet',
            route: '/competency/vehicle-imports',
            requires: { permission: 'vehicle-import:read', services: ['MIG-01'] },
            quickActions: [
                {
                    key: 'competency.newVehicleImport',
                    label: 'competency.action.newVehicleImport',
                    route: '/competency/vehicle-imports/new',
                    requires: { permission: 'vehicle-import:create', services: ['MIG-01'] }
                }
            ]
        },
        // sampling QA of migrated records (task 1.13g): the drawn records waiting for a re-check, and each clerk's counts
        {
            key: 'competency.migrationSamples',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.migrationSamples',
            icon: 'list-checks',
            route: '/competency/migration-samples',
            requires: { permission: 'migration-sample:read', services: ['MIG-01'] }
        },
        // the reconciliation report (task 1.13h): paper files counted against the vehicles migrated, per office and plate code
        {
            key: 'competency.migrationReport',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.migrationReport',
            icon: 'list-checks',
            route: '/competency/migration-report',
            requires: { permission: 'migration-report:read', services: ['MIG-01'] }
        },
        // campaign counters (task 1.13i): plate exchange and bolo season, each office's daily count against its target
        {
            key: 'competency.campaigns',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.campaigns',
            icon: 'target',
            route: '/competency/campaigns',
            requires: { permission: 'campaign:read' }
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
            key: 'competency.ownershipTransfers',
            group: 'work-process',
            order: 14,
            label: 'competency.nav.ownershipTransfers',
            icon: 'repeat',
            route: '/competency/ownership-transfers',
            requires: { permission: 'vehicle:read', services: ['DVC-13'] },
            quickActions: [
                {
                    key: 'competency.newOwnershipTransfer',
                    label: 'competency.action.newOwnershipTransfer',
                    route: '/competency/ownership-transfers/new',
                    requires: { permission: 'case:create', services: ['DVC-13'] }
                }
            ]
        },
        {
            key: 'competency.vehicleTransfers',
            group: 'work-process',
            order: 14,
            label: 'competency.nav.vehicleTransfers',
            icon: 'arrow-left-right',
            route: '/competency/vehicle-transfers',
            requires: { permission: 'vehicle:read', services: ['DVC-14', 'DVC-15'] },
            quickActions: [
                {
                    key: 'competency.newTransferOut',
                    label: 'competency.action.newTransferOut',
                    route: '/competency/vehicle-transfers/out/new',
                    requires: { permission: 'case:create', services: ['DVC-14'] }
                },
                {
                    key: 'competency.newTransferIn',
                    label: 'competency.action.newTransferIn',
                    route: '/competency/vehicle-transfers/in/new',
                    requires: { permission: 'case:create', services: ['DVC-15'] }
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
