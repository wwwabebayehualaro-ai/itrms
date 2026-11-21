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
    lookups: ['driver-licence', 'training-school', 'garage', 'office', 'released-vehicle'],
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
        },
        // whether an office of this region that receives a vehicle is also sent the covering letter (task 1.4c2, ADR-0058): a
        // vehicle leaving the region always has one
        {
            key: 'competency.vehicle_transfer_covering_letter',
            default: false,
            overridableAt: ['installation', 'region', 'unitType', 'unit']
        },
        // whether a release to another region may be cancelled without its transfer document once the document has lapsed (task
        // 1.4c2b, ADR-0059); a region may insist on the document
        {
            key: 'competency.vehicle_release_cancel_unreturned',
            default: true,
            overridableAt: ['installation', 'region'],
            // a change loosens or tightens a control: it needs a fresh second factor (SEC-SE-5)
            sensitive: true
        },
        // whether a vehicle that arrives from another region on an old regional plate is given a national plate in the same case (task
        // 1.4c3, ADR-0060; Directive 1050/2025): on until the region says otherwise
        {
            key: 'competency.vehicle_transfer_plate_exchange',
            default: true,
            overridableAt: ['installation', 'region'],
            // turning it off lets an old plate stay on the register: a change needs a fresh second factor (SEC-SE-5)
            sensitive: true
        },
        // the days a lost or stolen libre waits after its newspaper notice before it is replaced (task 1.5, ADR-0062: 15, the zone's
        // written answer); shortening it relaxes a control, so a change needs a fresh second factor (SEC-SE-5)
        {
            key: 'competency.libre_notice_days',
            default: 15,
            overridableAt: ['installation', 'region'],
            sensitive: true
        },
        // how the region numbers its licences (task 1.6, ADR-0051): one regional sequence from its code and the first number of
        // the range it reserves for ITRMS (Z), or per office. A change moves the numbers people carry: a fresh second factor
        {
            key: 'competency.licence_number',
            default: { scope: 'region' },
            overridableAt: ['installation', 'region'],
            sensitive: true
        },
        // whether the region collects the blood group for the card (task 1.6, ADR-0052): off until it says so (Z); turning it on
        // collects a health fact, so a change needs a fresh second factor
        {
            key: 'competency.card_shows_blood_group',
            default: false,
            overridableAt: ['installation', 'region'],
            sensitive: true
        },
        // which expired paper licences a back-capture takes (task 1.6b): every one by default, as Proclamation 1074/2018 Art. 19 keeps
        // them renewable; a region may refuse those over a year late, or every expired one. A change moves a control: a fresh second factor
        {
            key: 'competency.licence_capture_expired',
            default: 'accept',
            overridableAt: ['installation', 'region'],
            sensitive: true
        },
        // whether the intake desk reads the licence register (task 1.6b2, ADR-0065): on, so the desk looks a licence up before it
        // files a renewal, a replacement or a paper back-capture; a region or a unit type may keep the register to licensing.
        // Never one office's own (an office does not widen its own access); a change needs a fresh second factor
        {
            key: 'competency.intake_reads_licences',
            default: true,
            overridableAt: ['installation', 'region', 'unitType'],
            sensitive: true
        },
        // the months a holder whose licence was cancelled waits before a new application (task 1.6c): the proclamation sets no
        // figure here, so none (0) until the region says (Z); a change moves a control, so a fresh second factor
        {
            key: 'competency.reapply_after_cancellation_months',
            default: 0,
            overridableAt: ['installation', 'region'],
            sensitive: true
        },
        // the days a temporary driving permit stands while the region prints (task 1.6d, ADR-0064 §7: 90, a placeholder, Z); a
        // unit type may need longer where cards take longer to come
        {
            key: 'competency.driving_permit_days',
            default: 90,
            overridableAt: ['installation', 'region', 'unitType']
        }
    ],
    // the intake desk reads the licence register where the setting above is on (ADR-0065)
    roleGrants: [
        { role: 'records_officer', permissions: ['licence:read'], setting: 'competency.intake_reads_licences' }
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
        // a renewal's medical referral letter and the health bureau's report (task 1.6a)
        'competency.issueMedicalReferral',
        'competency.recordMedicalReport',
        // the back-capture of a paper driver licence (task 1.6b)
        'competency.checkLicenceCapture',
        'competency.captureLicence',
        'competency.flagLicenceNumber',
        'competency.checkLicenceRestriction',
        'competency.recordLicenceRestriction',
        'competency.issueDrivingPermit',
        'competency.checkLicenceReplacement',
        'competency.replaceLicenceCard',
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
        'competency.releaseVehicleOut',
        'competency.checkTransferIn',
        'competency.recordTransferInspection',
        'competency.receiveVehicle',
        'competency.checkReleaseCancel',
        'competency.cancelRelease',
        'competency.checkTransferArrival',
        'competency.registerArrival',
        'competency.issueArrivalCertificate',
        'competency.checkBolo',
        'competency.recordBoloInspection',
        'competency.issueBoloSticker',
        'competency.issueTemporaryBolo',
        'competency.voidBolo',
        'competency.recordBoloRepair',
        // the replacement of a lost, stolen or damaged libre (task 1.5), bolo sticker (task 1.5b) and plate (task 1.5c)
        'competency.checkReplacement',
        'competency.checkReplacementNotice',
        'competency.replaceLibre',
        'competency.replaceBoloSticker',
        'competency.replacePlate'
    ],
    title: { am: 'የአሽከርካሪና ተሽከርካሪ ብቃት ማረጋገጫ', en: 'Driver and vehicle competency' },
    workProcess: 1,
    entitlement: 'itrms.licensing',
    permissions: {
        // hand-over: the card given to its holder at the desk, which closes the temporary permit (task 1.6d)
        licence: ['read', 'issue', 'print', 'hand-over'],
        // a licence's health facts (task 1.6, ADR-0052): the blood group recorded, and read in clear only through the audited reveal
        'licence-health': ['record', 'reveal'],
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
            'licence:hand-over',
            'licence-health:record',
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
            'licence:hand-over',
            // the lead alone reads a blood group in clear, for licences its subtree handles (ADR-0064 §4)
            'licence-health:record',
            'licence-health:reveal',
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
        { key: 'transfer-letter', pattern: '{unit}/OT/{seq:05}/{efy}' },
        // a renewal's referral letter to a health facility (task 1.6a)
        { key: 'medical-referral', pattern: '{unit}/MR/{seq:05}/{efy}' },
        // the temporary driving permit a renewal gives while the region prints (task 1.6d)
        { key: 'driving-permit', pattern: '{unit}/TP/{seq:05}/{efy}' },
        // the vehicle data transfer document of a vehicle leaving the region, and its covering letter (task 1.4c2)
        { key: 'transfer-document', pattern: '{unit}/VT/{seq:05}/{efy}' }
    ],
    countersRequired: {
        'DVC-01': ['vehicles.registration-certificate'],
        'DVC-02': ['competency.temporary-bolo'],
        'DVC-03': ['competency.licence'],
        'DVC-04': ['competency.medical-referral', 'competency.driving-permit'],
        // a replacement's temporary driving permit while the new card prints (task 1.6e)
        'DVC-19': ['competency.driving-permit'],
        // the new libre's registration certificate (task 1.5)
        'DVC-06': ['vehicles.registration-certificate'],
        'DVC-13': ['vehicles.registration-certificate', 'competency.transfer-letter'],
        'DVC-14': ['competency.transfer-document'],
        // the registration certificate of the vehicle that arrives (task 1.4c3)
        'DVC-17': ['vehicles.registration-certificate']
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
        // a release cancelled by the office that made it (task 1.4c2b, ADR-0059)
        'DVC-16',
        // a vehicle that arrives from another region, on its transfer document (task 1.4c3, ADR-0060)
        'DVC-17',
        // the replacement of a licence's card (task 1.6e, Art. 18)
        'DVC-19',
        // the suspension and cancellation record of a licence, from the deciding authority (task 1.6c, ADR-0064 §6)
        'DVC-21',
        // the back-capture of paper vehicle files (ADR-0054): the migration's own service, beside the bureau's
        'MIG-01',
        // and of paper driver licences (task 1.6b)
        'MIG-02'
    ],
    // a registration takes its plate from the office's own stock (task 1.2b): an office without one doesn't offer it
    // the transfer issues a libre, from the office's stationery (booklets)
    capabilitiesRequired: {
        'DVC-01': ['holds_plate_stock'],
        // a new libre is written in a booklet and a bolo takes a sticker from the office's stationery; a new plate comes from its plate stock
        'DVC-06': ['holds_stationery', 'holds_plate_stock'],
        'DVC-12': ['holds_plate_stock'],
        'DVC-13': ['holds_stationery'],
        // the vehicle's stock plate joins the receiving office's stock (task 1.4c)
        'DVC-15': ['holds_plate_stock'],
        // a vehicle on an old plate is given a national plate from the office's stock in the same case (task 1.4c3)
        'DVC-17': ['holds_plate_stock']
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
            key: 'competency.licenceCaptures',
            group: 'work-process',
            order: 13,
            label: 'competency.nav.licenceCaptures',
            icon: 'archive',
            route: '/competency/licence-captures',
            requires: { permission: 'licence:read', services: ['MIG-02'] },
            quickActions: [
                {
                    key: 'competency.newLicenceCapture',
                    label: 'competency.action.newLicenceCapture',
                    route: '/competency/licence-captures/new',
                    requires: { permission: 'case:create', services: ['MIG-02'] }
                }
            ]
        },
        {
            key: 'competency.licenceReplacements',
            group: 'work-process',
            order: 15,
            label: 'competency.nav.licenceReplacements',
            icon: 'copy',
            route: '/competency/licence-replacements',
            requires: { permission: 'licence:read', services: ['DVC-19'] },
            quickActions: [
                {
                    key: 'competency.newLicenceReplacement',
                    label: 'competency.action.newLicenceReplacement',
                    route: '/competency/licence-replacements/new',
                    requires: { permission: 'case:create', services: ['DVC-19'] }
                }
            ]
        },
        {
            key: 'competency.licenceRestrictions',
            group: 'work-process',
            order: 15,
            label: 'competency.nav.licenceRestrictions',
            icon: 'ban',
            route: '/competency/licence-restrictions',
            requires: { permission: 'licence:read', services: ['DVC-21'] },
            quickActions: [
                {
                    key: 'competency.newLicenceRestriction',
                    label: 'competency.action.newLicenceRestriction',
                    route: '/competency/licence-restrictions/new',
                    requires: { permission: 'case:create', services: ['DVC-21'] }
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
            key: 'competency.replacements',
            group: 'work-process',
            order: 14,
            label: 'competency.nav.replacements',
            icon: 'file-warning',
            route: '/competency/replacements',
            requires: { permission: 'vehicle:read', services: ['DVC-06'] },
            quickActions: [
                {
                    key: 'competency.newReplacement',
                    label: 'competency.action.newReplacement',
                    route: '/competency/replacements/new',
                    requires: { permission: 'case:create', services: ['DVC-06'] }
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
            requires: { permission: 'vehicle:read', services: ['DVC-14', 'DVC-15', 'DVC-16', 'DVC-17'] },
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
                },
                {
                    key: 'competency.newReleaseCancel',
                    label: 'competency.action.newReleaseCancel',
                    route: '/competency/vehicle-transfers/cancel/new',
                    requires: { permission: 'case:create', services: ['DVC-16'] }
                },
                {
                    key: 'competency.newTransferArrival',
                    label: 'competency.action.newTransferArrival',
                    route: '/competency/vehicle-transfers/arrival/new',
                    requires: { permission: 'case:create', services: ['DVC-17'] }
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
