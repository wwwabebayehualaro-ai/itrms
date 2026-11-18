/**
 * DVC-17, a vehicle arriving from another region (task 1.4c3, ADR-0060), as configuration: its request form, the plate step's form
 * and its workflow, seeded as the service's first version at the region's root with the fee rule it names. The officer files the
 * vehicle's facts as a registration does and the facts of the transfer document the owner brought; nothing is fetched from the other
 * region. A vehicle on an old regional plate is given a national plate from the office's stock in the same case when the region's
 * setting asks for it: held at the final approval and put on the vehicle when it is registered.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import { ARRIVAL_VERIFIED_HOW } from '@itrms/vehicles/contracts';

import {
    REGISTRATION_EFFECTS as R,
    TRANSFER_ARRIVAL_EFFECTS as A,
    TRANSFER_ARRIVAL_SERVICE,
    VEHICLE_TRANSFER_EFFECTS as X
} from '../contracts';
import { TRANSFER_INSPECTION_FORM } from './vehicle-transfer-service';
import { VEHICLE_REGISTRATION_FORM } from './vehicle-services';
import {
    ACTIONS,
    approvedFeeRule,
    attachment,
    DRAFT,
    FEE,
    field,
    firstServiceVersion,
    PAID,
    publishedForm,
    REJECT_ROLES,
    REVIEW_LABEL,
    task,
    text,
    WITHDRAW,
    workflowVersion
} from './service-config';

type FormField = (typeof VEHICLE_REGISTRATION_FORM.fields)[number];

/** The registration's fields for the owners and the vehicle's facts, as they are: the document gives the same facts. */
const REUSED = [
    'owners',
    'ownerPerson',
    'ownerOrganisation',
    'chassisNumber',
    'chassisKind',
    'chassisMismatchConfirmed',
    'engineNumber',
    'make',
    'model',
    'modelYear',
    'categoryKey',
    'use',
    'seats',
    'loadCapacityKg',
    'grossWeightKg',
    'engineCc',
    'axles',
    'colour',
    'fuel',
    'madeIn',
    'engineHp',
    'cylinders',
    'lengthM',
    'widthM',
    'heightM',
    'tyreSize',
    'tyres',
    'netWeightKg'
] as const;
const reused = (ids: readonly string[]): FormField[] =>
    VEHICLE_REGISTRATION_FORM.fields.filter((f) => ids.includes(f.id));

/** A fact of the document or of the vehicle's papers: internal, not personal. */
const fact = (id: string, type: string, label: I18nText, props: Record<string, unknown> = {}, extra = {}) =>
    field(id, type, label, props, { classification: 'internal', ...extra });

const VERIFIED_HOW_LABELS: Record<(typeof ARRIVAL_VERIFIED_HOW)[number], I18nText> = {
    verification_page: text('በሰጪው አካል የማረጋገጫ ድረ ገጽ', "On the issuing body's verification page"),
    letter: text('በደብዳቤ', 'By letter')
};

/**
 * The request. The vehicle's field ids are the registration's (the register's own names), so a refusal points at the box it is
 * about; the dates are entered in the Ethiopian calendar. The scan of the document is required: the officer checked it, and the
 * record keeps it. The tick that the vehicle takes a national plate is what the fee's plate line follows (a fee reads answers only).
 */
export const TRANSFER_ARRIVAL_FORM = {
    schemaVersion: 2,
    fields: [
        fact('transferDocumentNumber', 'InputText', text('የማስተላለፊያ ሰነድ ቁጥር', 'Transfer document number'), {
            maxLength: 60
        }),
        fact('issuingRegion', 'InputText', text('ሰነዱን የሰጠው ክልል', 'Region that issued the document'), {
            maxLength: 100
        }),
        fact('issuingOffice', 'InputText', text('ሰነዱን የሰጠው መሥሪያ ቤት', 'Office that issued the document'), {
            maxLength: 200
        }),
        fact('documentDate', 'EthDate', text('ሰነዱ የተሰጠበት ቀን', 'Document date')),
        fact('documentValidUntil', 'EthDate', text('ሰነዱ የሚያገለግልበት የመጨረሻ ቀን', 'Document valid until')),
        fact(
            'documentVerified',
            'Checkbox',
            text(
                'ሰነዱን በሰጪው አካል የማረጋገጫ ድረ ገጽ ወይም በደብዳቤ አረጋግጫለሁ',
                'I checked the document with the issuing body, on its verification page or by letter'
            ),
            { required: false }
        ),
        fact(
            'verifiedHow',
            'Dropdown',
            text('ሰነዱ እንዴት ተረጋገጠ', 'How the document was checked'),
            { required: true },
            {
                data: {
                    dataSource: {
                        staticData: ARRIVAL_VERIFIED_HOW.map((value) => ({ label: VERIFIED_HOW_LABELS[value], value }))
                    }
                }
            }
        ),
        fact('holdsListed', 'Checkbox', text('ሰነዱ በተሽከርካሪው ላይ እገዳ ይዘረዝራል', 'The document lists holds on the vehicle'), {
            required: false
        }),
        fact('holdsNote', 'InputTextarea', text('የእገዳዎቹ ዝርዝር', 'The holds it lists'), {
            required: false,
            maxLength: 500
        }),
        field('transferDocumentScan', 'FileUpload', text('የተቃኘው የማስተላለፊያ ሰነድ', 'The scanned transfer document'), {
            required: true
        }),
        ...reused(['owners', 'ownerPerson', 'ownerOrganisation']),
        fact('firstRegisteredOn', 'EthDate', text('መጀመሪያ የተመዘገበበት ቀን', 'First registered on')),
        fact(
            'ownersSince',
            'EthDate',
            text('ባለቤቶቹ የያዙበት ቀን (ሰነዱ ከገለጸ)', 'Held by these owners since (if the document says)'),
            { required: false }
        ),
        fact('federalVehicleId', 'InputText', text('የፌዴራል ተሽከርካሪ መለያ (ካለ)', 'Federal vehicle id (if any)'), {
            required: false,
            maxLength: 40
        }),
        fact('plate', 'InputText', text('ተሽከርካሪው የያዘው ሰሌዳ', 'The plate it carries'), { maxLength: 40 }),
        fact(
            'takesNationalPlate',
            'Checkbox',
            text('አሮጌ የክልል ሰሌዳው በብሔራዊ ሰሌዳ ይቀየራል', 'The old regional plate is exchanged for a national plate'),
            { required: false }
        ),
        fact('libreNumber', 'InputText', text('የፌዴራል ሊብሬ ቁጥር', 'Federal libre number'), { maxLength: 40 }),
        fact('libreIssuedOn', 'EthDate', text('ሊብሬው የተሰጠበት ቀን', 'Libre issued on')),
        fact(
            'boloValidUntil',
            'EthDate',
            text('የሌላው ክልል ቦሎ የሚያገለግልበት የመጨረሻ ቀን', "The other region's bolo valid until"),
            {
                required: false
            }
        ),
        ...reused(REUSED.filter((id) => !id.startsWith('owner'))),
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', "Owner's identity document")),
        attachment('libreCopy', text('የሊብሬ ቅጂ', 'Copy of the libre'), 'internal'),
        FEE
    ]
};

/**
 * The arrival step's answers: the plate handed over when it is not the one held for the case. Only a vehicle exchanging its old
 * plate has one held.
 */
export const ARRIVAL_PLATE_FORM = {
    schemaVersion: 2,
    fields: [
        fact(
            'replacementPlate',
            'InputText',
            text('የተሰጠው ሰሌዳ (ከተያዘው የተለየ ከሆነ)', 'Plate handed over (if not the reserved one)'),
            { required: false, maxLength: 40 }
        )
    ]
};

const EXCHANGES = { fact: 'transferArrival.plateExchange', op: 'eq', value: true };

/**
 * DVC-17: review, the inspection when the case's facts ask for one (the setting at the filing), payment, final approval, and the
 * arrival, which registers the vehicle and issues its certificate. The first transition whose guard holds is taken: with an
 * inspection review goes to it, otherwise to payment; a vehicle exchanging its plate has a national plate held at the approval and
 * put on it at the arrival, in the same step as the registration. The approver does not register.
 */
export const transferArrivalFlow = (inspectionForm: string, plateForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        task('inspection', text('ምርመራ', 'Inspection'), 'competency.inspector', 3, {
            stepForm: inspectionForm,
            separationOfDuties: ['draft']
        }),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        {
            key: 'approval',
            kind: 'task',
            label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['draft', 'review', 'inspection'],
            sla: { businessDays: 2 }
        },
        task('arrival', text('ተሽከርካሪውን መመዝገብ', 'Register the vehicle'), 'competency.officer', 2, {
            stepForm: plateForm,
            separationOfDuties: ['approval']
        }),
        { key: 'registered', kind: 'end', label: text('ተመዝግቧል', 'Registered') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [A.checkTransferArrival] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', A.checkTransferArrival]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'review',
            to: 'inspection',
            action: 'approve',
            label: ACTIONS.approve,
            guard: { fact: 'transferArrival.reinspect', op: 'eq', value: true },
            effects: [A.checkTransferArrival]
        },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            effects: [A.checkTransferArrival, 'fees.createPaymentOrder']
        },
        { from: 'inspection', to: 'review', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'inspection',
            to: 'payment',
            action: 'inspect',
            label: text('ምርመራውን መዝግብ', 'Record the inspection'),
            effects: [X.recordTransferInspection, 'fees.createPaymentOrder']
        },
        { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        // the first whose guard holds is taken: a vehicle exchanging its plate has one held for it from here
        {
            from: 'approval',
            to: 'arrival',
            action: 'approve',
            label: ACTIONS.approve,
            guard: { all: [PAID, EXCHANGES] },
            effects: [A.checkTransferArrival, R.reserveRegistrationPlate]
        },
        {
            from: 'approval',
            to: 'arrival',
            action: 'approve',
            label: ACTIONS.approve,
            guard: PAID,
            effects: [A.checkTransferArrival]
        },
        {
            from: 'arrival',
            to: 'registered',
            action: 'register',
            label: text('መዝግብ', 'Register the vehicle'),
            guard: { all: [PAID, EXCHANGES] },
            effects: [A.checkTransferArrival, A.registerArrival, R.assignRegistrationPlate, A.issueArrivalCertificate]
        },
        {
            from: 'arrival',
            to: 'registered',
            action: 'register',
            label: text('መዝግብ', 'Register the vehicle'),
            guard: PAID,
            effects: [A.checkTransferArrival, A.registerArrival, A.issueArrivalCertificate]
        },
        WITHDRAW,
        {
            from: ['review', 'inspection', 'approval', 'arrival'],
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true,
            // the plate held for the case goes back to the office's stock
            effects: [R.releaseRegistrationPlate]
        }
    ]
});

/** DVC-17 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importTransferArrivalService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = TRANSFER_ARRIVAL_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('ከሌላ ክልል የመጣ ተሽከርካሪ ምዝገባ', 'Register a vehicle transferred from another region');
    const inspection = await publishedForm(
        tx,
        root,
        'vehicle-transfer-inspection',
        text('የዝውውር ምርመራ', 'Transfer inspection'),
        TRANSFER_INSPECTION_FORM
    );
    const plate = await publishedForm(
        tx,
        root,
        'vehicle-arrival-plate',
        text('የሰሌዳ ቅያሪ መረጃ', 'Plate exchange entry'),
        ARRIVAL_PLATE_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-transfer-arrival', name, TRANSFER_ARRIVAL_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-transfer-arrival',
            name,
            transferArrivalFlow(
                `vehicle-transfer-inspection@${inspection.number}`,
                `vehicle-arrival-plate@${plate.number}`
            )
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-17-arrival')
    });
    return 1;
}
