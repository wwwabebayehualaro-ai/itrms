/**
 * DVC-14, the transfer out, and DVC-15, the transfer in (task 1.4c, ADR-0057): their request forms, the receiving office's
 * inspection form and the two workflows, seeded as each service's first version at the region's root. The rules a bureau sets
 * are configuration: the fee of each service (the zone's fee sheet: 2,000 Birr; the demo charges it on the transfer out, the
 * transfer in has none), the forms, and the settings (how long a release stands, whether the vehicle is inspected again).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';

import {
    MAX_EARLIER_PLATES,
    MAX_TRANSFER_DOCUMENT_BIRR,
    RELEASE_CANCEL_SERVICE,
    TRANSFER_IN_SERVICE,
    TRANSFER_OUT_DESTINATIONS,
    TRANSFER_OUT_SERVICE,
    VEHICLE_TRANSFER_DOCUMENT_COUNTER,
    VEHICLE_TRANSFER_DOCUMENT_PATTERN,
    VEHICLE_TRANSFER_EFFECTS as X
} from '../contracts';
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
    supersedeSeededVersion,
    task,
    text,
    WITHDRAW,
    workflowVersion
} from './service-config';

/** A fact of the transfer, internal: no person's own data. */
const internal = (
    id: string,
    type: string,
    label: I18nText,
    props: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
) => field(id, type, label, props, { classification: 'internal', ...extra });

/**
 * The request at the office that handles the vehicle: the vehicle, where it goes (an office of the region, or outside it, ADR-0058:
 * another region, or an office without ITRMS), why, and the owner's papers. The office is asked only for a vehicle that stays in
 * the region; the name and region of the body outside only for one that leaves it. A request with no destination is for an office.
 */
export const TRANSFER_OUT_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'vehicle' }),
        internal(
            'destination',
            'Dropdown',
            text('የሚዛወርበት', 'Where it moves to'),
            { required: false },
            {
                data: {
                    dataSource: {
                        staticData: TRANSFER_OUT_DESTINATIONS.map((value) => ({
                            label:
                                value === 'office'
                                    ? text('የዚህ ክልል መሥሪያ ቤት', 'an office of this region')
                                    : text(
                                          'ሌላ ክልል ወይም ITRMS የሌለው መሥሪያ ቤት',
                                          'another region or an office without ITRMS'
                                      ),
                            value
                        }))
                    }
                }
            }
        ),
        internal(
            'toOffice',
            'RegistryLookup',
            text('የሚዛወርበት መሥሪያ ቤት', 'Office it moves to'),
            { provider: 'office' },
            {
                behavior: {
                    validation: { supported: true },
                    visibilityConditions: [{ field: 'destination', operator: 'neq', value: 'outside' }]
                }
            }
        ),
        internal(
            'destinationName',
            'InputText',
            text('የሚዛወርበት መሥሪያ ቤት ስም', 'Name of the office it moves to'),
            { maxLength: 200 },
            {
                behavior: {
                    validation: { supported: true },
                    visibilityConditions: [{ field: 'destination', operator: 'eq', value: 'outside' }]
                }
            }
        ),
        internal(
            'destinationRegion',
            'InputText',
            text('የሚዛወርበት ክልል', 'Region it moves to'),
            { maxLength: 100 },
            {
                behavior: {
                    validation: { supported: true },
                    visibilityConditions: [{ field: 'destination', operator: 'eq', value: 'outside' }]
                }
            }
        ),
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

/** A whole-Birr figure of the document: the service checks its range again and prints it as santim. */
const birr = (id: string, label: I18nText) =>
    internal(id, 'InputNumber', label, { required: false, min: 1, max: MAX_TRANSFER_DOCUMENT_BIRR });

/**
 * The document step of a transfer out of the region (ADR-0058): the papers the owner brought, the plates the vehicle carried before
 * this register's, and a remark. Everything is optional: the document prints a dash for what is not given.
 */
export const TRANSFER_DOCUMENT_FORM = {
    schemaVersion: 2,
    fields: [
        internal('customsDeclarationNumber', 'InputText', text('የጉምሩክ ማሳወቂያ ቁጥር', 'Customs declaration number'), {
            required: false,
            maxLength: 40
        }),
        internal('taxReceiptNumber', 'InputText', text('የግብር ደረሰኝ ቁጥር', 'Tax receipt number'), {
            required: false,
            maxLength: 40
        }),
        birr('purchaseValueBirr', text('የግዢ ዋጋ (ብር)', 'Purchase value (Birr)')),
        birr('excisePaidBirr', text('የተከፈለ ኤክሳይስ ታክስ (ብር)', 'Excise tax paid (Birr)')),
        field(
            'earlierPlates',
            'FormArray',
            text('ከዚህ በፊት የነበሩ ሰሌዳዎች', 'Earlier plates'),
            {
                required: false,
                minItems: 0,
                maxItems: MAX_EARLIER_PLATES,
                itemLabel: text('ሰሌዳ', 'Plate'),
                addButtonLabel: text('ሰሌዳ ጨምር', 'Add a plate')
            },
            { category: 'Layout', classification: 'internal', layout: { options: { isContainer: true } } }
        ),
        internal('plate', 'InputText', text('የሰሌዳ ቁጥር', 'Plate'), { maxLength: 40 }, { parentId: 'earlierPlates' }),
        internal(
            'year',
            'InputNumber',
            text('ዓመት (ዓ.ም)', 'Year (E.C.)'),
            { min: 1900, max: 2100 },
            { parentId: 'earlierPlates' }
        ),
        internal(
            'place',
            'InputText',
            text('የተሰጠበት ቦታ', 'Where it was issued'),
            { maxLength: 100 },
            { parentId: 'earlierPlates' }
        ),
        internal('remarks', 'InputTextarea', text('ማስታወሻ', 'Remarks'), { required: false, maxLength: 500 })
    ]
};

/**
 * The cancellation of a release (DVC-16, ADR-0059), filed at the office that released the vehicle: the vehicle (one with a release
 * standing from this office), the number of the transfer document handed back (a release to another region), the reason, and the
 * papers. No fee: to confirm with the zone.
 */
export const RELEASE_CANCEL_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'released-vehicle' }),
        internal(
            'documentNumber',
            'InputText',
            text(
                'ተመላሽ የሆነው የማስተላለፊያ ሰነድ ቁጥር (ወደ ሌላ ክልል ለተሰጠ መልቀቂያ)',
                'Number of the transfer document handed back (a release to another region)'
            ),
            { required: false, maxLength: 40 }
        ),
        internal('reason', 'InputTextarea', text('የመሰረዙ ምክንያት', 'Why the release is cancelled'), { maxLength: 500 }),
        attachment('returnedDocument', text('ተመላሽ የሆነው ሰነድ ቅጂ', 'Copy of the document handed back'), 'internal'),
        attachment('ownerRequest', text('የባለቤቱ ጥያቄ', "Owner's request"))
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
 * DVC-14: review, payment, final approval, then the release to the office named, or, for a vehicle leaving the region
 * (`transferOut.outside`, ADR-0058), the transfer document. Each step that moves the case on checks the vehicle (still the
 * office's, the owners the filing saw, no other request on it) and its holds again. The approver does not release.
 */
export const transferOutFlow = (documentForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        APPROVAL,
        task('release', text('ተሽከርካሪውን መልቀቅ', 'Release the vehicle'), 'competency.officer', 1, {
            separationOfDuties: ['approval']
        }),
        task('document', text('የመረጃ ማስተላለፊያ ሰነድ መስጠት', 'Transfer document'), 'competency.officer', 1, {
            stepForm: documentForm,
            separationOfDuties: ['approval']
        }),
        { key: 'released', kind: 'end', label: text('ለሌላ መሥሪያ ቤት ተለቋል', 'Released to the other office') },
        { key: 'transferred_out', kind: 'end', label: text('ከክልሉ ወጥቷል', 'Transferred out of the region') },
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
        // the first whose guard holds is taken: a vehicle leaving the region goes to the document, any other to its release
        {
            from: 'approval',
            to: 'document',
            action: 'approve',
            label: ACTIONS.approve,
            guard: { all: [PAID, { fact: 'transferOut.outside', op: 'eq', value: true }] },
            effects: [ENC]
        },
        { from: 'approval', to: 'release', action: 'approve', label: ACTIONS.approve, guard: PAID, effects: [ENC] },
        {
            from: 'release',
            to: 'released',
            action: 'release',
            label: text('ተሽከርካሪውን ልቀቅ', 'Release the vehicle'),
            guard: PAID,
            effects: [X.checkTransferOut, ENC, X.releaseVehicle]
        },
        {
            from: 'document',
            to: 'transferred_out',
            action: 'issue_document',
            label: text('ሰነዱን ስጥ', 'Issue the transfer document'),
            guard: PAID,
            effects: [X.checkTransferOut, ENC, X.releaseVehicleOut]
        },
        WITHDRAW,
        REJECT(['review', 'approval', 'release', 'document'])
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

/**
 * DVC-16: review by an officer, then the final approval of a lead (not the filer or the checker), which cancels the release. The
 * check runs again on every step that moves on, and again on the approval: the release may have been received, or its transfer
 * in filed, since.
 */
export const releaseCancelFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        APPROVAL,
        { key: 'cancelled', kind: 'end', label: text('መልቀቂያው ተሰርዟል', 'Release cancelled') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [X.checkReleaseCancel] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: [X.checkReleaseCancel]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        { from: 'review', to: 'approval', action: 'approve', label: ACTIONS.approve, effects: [X.checkReleaseCancel] },
        {
            from: 'approval',
            to: 'cancelled',
            action: 'approve',
            label: text('መልቀቂያውን ሰርዝ', 'Cancel the release'),
            effects: [X.checkReleaseCancel, X.cancelRelease]
        },
        WITHDRAW,
        REJECT(['review', 'approval'])
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

/** The transfer document's counter at every office that offers DVC-14. Returns how many offices have it. */
export async function setUpVehicleTransferDocumentCounters(
    tx: Tx,
    regionId: string,
    pattern = VEHICLE_TRANSFER_DOCUMENT_PATTERN
): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = ${TRANSFER_OUT_SERVICE}`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: VEHICLE_TRANSFER_DOCUMENT_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

/**
 * DVC-14 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. Seeded before
 * 1.4c2, the seed's own version moves to today's request form and flow (the bureau's own is never touched).
 */
export async function importTransferOutService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const service = await serviceOf(tx, root.regionId, TRANSFER_OUT_SERVICE);
    const name = text('ተሽከርካሪ ከመሥሪያ ቤት ማዛወር', 'Vehicle transfer out');
    const document = await publishedForm(
        tx,
        root,
        'vehicle-transfer-document',
        text('የተሽከርካሪ መረጃ ማስተላለፊያ ሰነድ', 'Vehicle data transfer document'),
        TRANSFER_DOCUMENT_FORM
    );
    const flow = transferOutFlow(`vehicle-transfer-document@${document.number}`);
    if (service.currentVersionId)
        return (await supersedeSeededVersion(tx, root, service, 'vehicle-transfer-out', flow, {
            key: 'vehicle-transfer-out',
            document: TRANSFER_OUT_FORM
        }))
            ? 1
            : 0;
    const form = await publishedForm(tx, root, 'vehicle-transfer-out', name, TRANSFER_OUT_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'vehicle-transfer-out', name, flow),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-14-transfer-out')
    });
    return 1;
}

/** DVC-16 at the region's root, with no fee (to confirm with the zone: a fee is a new version of the flow, configuration only). */
export async function importReleaseCancelService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const service = await serviceOf(tx, root.regionId, RELEASE_CANCEL_SERVICE);
    if (service.currentVersionId) return 0;
    const name = text('የተሽከርካሪ መልቀቂያ መሰረዝ', 'Cancel a vehicle release');
    const form = await publishedForm(tx, root, 'vehicle-release-cancel', name, RELEASE_CANCEL_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'vehicle-release-cancel', name, releaseCancelFlow()),
        feeRuleVersionId: null
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
