/**
 * DVC-14, the transfer out, and DVC-15, the transfer in (task 1.4c, ADR-0057): their request forms, the receiving office's
 * inspection form and the two workflows, seeded as each service's first version at the region's root. The rules a bureau sets
 * are configuration: the fee of each service (the zone's fee sheet: 2,000 Birr; the demo charges it on the transfer out, the
 * transfer in has none), the forms, and the settings (how long a release stands, whether the vehicle is inspected again).
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';

import { TRANSFER_IN_SERVICE, TRANSFER_OUT_SERVICE, VEHICLE_TRANSFER_EFFECTS as X } from '../contracts';
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

/** A fact of the transfer, internal: no person's own data. */
const internal = (id: string, type: string, label: I18nText, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/** The request at the office that handles the vehicle: the vehicle, the office it goes to, why, and the owner's papers. */
export const TRANSFER_OUT_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'vehicle' }),
        internal('toOffice', 'RegistryLookup', text('የሚዛወርበት መሥሪያ ቤት', 'Office it moves to'), { provider: 'office' }),
        internal('reason', 'InputText', text('የዝውውሩ ምክንያት', 'Why it moves'), { required: false, maxLength: 200 }),
        attachment('libreCopy', text('የሊብሬ ቅጂ', 'Copy of the libre'), 'internal'),
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', "Owner's identity document")),
        FEE
    ]
};

/** The request at the receiving office: the vehicle released to it. */
export const TRANSFER_IN_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'vehicle' }),
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', "Owner's identity document")),
        FEE
    ]
};

/** The receiving office's inspection, when its region asks for one. */
export const TRANSFER_INSPECTION_FORM = {
    schemaVersion: 2,
    fields: [
        internal(
            'inspectionMatches',
            'Checkbox',
            text('ተሽከርካሪው በመዝገቡ ያለው ነው', 'The vehicle is the one its record describes')
        ),
        internal('inspectionNote', 'InputText', text('ማስታወሻ', 'Note'), { required: false, maxLength: 500 })
    ]
};

/** The check that refuses the service while the vehicle is encumbered (task 1.4a), on filing and before each step that moves on. */
const ENC = 'vehicles.checkEncumbrances:zone-transfer-out';

const REJECT = (from: string[]) => ({
    from,
    to: 'rejected',
    action: 'reject',
    label: text('ውድቅ አድርግ', 'Reject'),
    rejectRoles: REJECT_ROLES,
    commentRequired: true
});

const APPROVAL = {
    key: 'approval',
    kind: 'task',
    label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
    assignee: { role: 'competency.lead', unit: '${approval_unit}' },
    separationOfDuties: ['draft', 'review'],
    sla: { businessDays: 2 }
};

/**
 * DVC-14: review, payment, final approval, then the release to the office named. Each step that moves the case on checks the
 * vehicle (still the office's, the owners the filing saw, no other request on it) and its holds again. The approver does not
 * release.
 */
export const transferOutFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        APPROVAL,
        task('release', text('ተሽከርካሪውን መልቀቅ', 'Release the vehicle'), 'competency.officer', 1, {
            separationOfDuties: ['approval']
        }),
        { key: 'released', kind: 'end', label: text('ለሌላ መሥሪያ ቤት ተለቋል', 'Released to the other office') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [X.checkTransferOut, ENC] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', X.checkTransferOut, ENC]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            effects: [X.checkTransferOut, ENC, 'fees.createPaymentOrder']
        },
        { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        { from: 'approval', to: 'release', action: 'approve', label: ACTIONS.approve, guard: PAID, effects: [ENC] },
        {
            from: 'release',
            to: 'released',
            action: 'release',
            label: text('ተሽከርካሪውን ልቀቅ', 'Release the vehicle'),
            guard: PAID,
            effects: [X.checkTransferOut, ENC, X.releaseVehicle]
        },
        WITHDRAW,
        REJECT(['review', 'approval', 'release'])
    ]
});

/**
 * DVC-15: review, the inspection when the case's facts ask for one (the setting at the filing), payment, final approval, then the
 * vehicle is received. The first transition whose guard holds is taken: with an inspection, review goes to it; otherwise to
 * payment.
 */
export const transferInFlow = (inspectionForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        task('inspection', text('ምርመራ', 'Inspection'), 'competency.inspector', 3, {
            stepForm: inspectionForm,
            separationOfDuties: ['draft']
        }),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        { ...APPROVAL, separationOfDuties: ['draft', 'review', 'inspection'] },
        task('receive', text('ተሽከርካሪውን መረከብ', 'Receive the vehicle'), 'competency.officer', 1, {
            separationOfDuties: ['approval']
        }),
        { key: 'received', kind: 'end', label: text('ተረክቧል', 'Received') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [X.checkTransferIn, ENC] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', X.checkTransferIn, ENC]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'review',
            to: 'inspection',
            action: 'approve',
            label: ACTIONS.approve,
            guard: { fact: 'transferIn.reinspect', op: 'eq', value: true },
            effects: [X.checkTransferIn, ENC]
        },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            effects: [X.checkTransferIn, ENC, 'fees.createPaymentOrder']
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
        { from: 'approval', to: 'receive', action: 'approve', label: ACTIONS.approve, guard: PAID, effects: [ENC] },
        {
            from: 'receive',
            to: 'received',
            action: 'receive',
            label: text('ተሽከርካሪውን ተረከብ', 'Receive the vehicle'),
            guard: PAID,
            effects: [X.checkTransferIn, ENC, X.receiveVehicle]
        },
        WITHDRAW,
        REJECT(['review', 'inspection', 'approval', 'receive'])
    ]
});

async function serviceOf(tx: Tx, regionId: string, code: string) {
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    return service;
}

/** DVC-14 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importTransferOutService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const service = await serviceOf(tx, root.regionId, TRANSFER_OUT_SERVICE);
    if (service.currentVersionId) return 0;
    const name = text('ተሽከርካሪ ከመሥሪያ ቤት ማዛወር', 'Vehicle transfer out');
    const form = await publishedForm(tx, root, 'vehicle-transfer-out', name, TRANSFER_OUT_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'vehicle-transfer-out', name, transferOutFlow()),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-14-transfer-out')
    });
    return 1;
}

/** DVC-15 at the region's root, with no fee: a bureau that charges one publishes a version with its fee rule. */
export async function importTransferInService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const service = await serviceOf(tx, root.regionId, TRANSFER_IN_SERVICE);
    if (service.currentVersionId) return 0;
    const name = text('ተሽከርካሪ ከሌላ መሥሪያ ቤት መቀበል', 'Vehicle transfer in');
    const inspection = await publishedForm(
        tx,
        root,
        'vehicle-transfer-inspection',
        text('የዝውውር ምርመራ', 'Transfer inspection'),
        TRANSFER_INSPECTION_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-transfer-in', name, TRANSFER_IN_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-transfer-in',
            name,
            transferInFlow(`vehicle-transfer-inspection@${inspection.number}`)
        ),
        feeRuleVersionId: null
    });
    return 1;
}
