/**
 * The back-capture of a paper vehicle file (MIG-01, ADR-0054, task 1.13) as configuration: its form and its workflow, and nothing
 * else. A clerk captures the paper file's facts and its scan; a second person checks them against the paper and verifies, and only
 * then does the vehicle join the register. No fee: the migration is the office's work, not a service to the owner. Like the other
 * services it only ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';

import { BACK_CAPTURE_EFFECTS as B, BACK_CAPTURE_SERVICE } from '../contracts';
import {
    DRAFT,
    field,
    firstServiceVersion,
    publishedForm,
    REJECT_ROLES,
    task,
    text,
    WITHDRAW,
    workflowVersion
} from './service-config';
import { VEHICLE_REGISTRATION_FORM } from './vehicle-services';

type FormField = (typeof VEHICLE_REGISTRATION_FORM.fields)[number];

/** The registration's fields for the owners and the vehicle's facts, as they are: a paper file records the same. */
const REUSED = new Set([
    'owners',
    'ownerPerson',
    'ownerOrganisation',
    'chassisNumber',
    'chassisKind',
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
]);
const reused = (ids: readonly string[]): FormField[] =>
    VEHICLE_REGISTRATION_FORM.fields.filter((f) => ids.includes(f.id) && REUSED.has(f.id));
const FACTS = [...REUSED].filter((id) => !id.startsWith('owner'));

/** A fact of the paper file: internal, not personal. */
const fileFact = (id: string, type: string, label: ReturnType<typeof text>, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/**
 * The capture, filed by a clerk from the paper file. The vehicle's field ids are the registration's (the register's own names), so a
 * refusal points at the box it is about; the file's dates are entered in the Ethiopian calendar. The scan is required: the second
 * person checks the capture against it, and the record keeps it.
 */
export const BACK_CAPTURE_FORM = {
    schemaVersion: 2,
    fields: [
        fileFact('paperReference', 'InputText', text('የወረቀት ፋይል ቁጥር', 'Paper file reference'), { maxLength: 60 }),
        field('paperFileScan', 'FileUpload', text('የተቃኘው የወረቀት ፋይል', 'The scanned paper file'), { required: true }),
        ...reused(['owners', 'ownerPerson', 'ownerOrganisation']),
        fileFact(
            'ownersSince',
            'EthDate',
            text('ባለቤቶቹ የያዙበት ቀን (ፋይሉ ከገለጸ)', 'Held by these owners since (if the file says)'),
            { required: false }
        ),
        fileFact('firstRegisteredOn', 'EthDate', text('መጀመሪያ የተመዘገበበት ቀን', 'First registered on')),
        fileFact('federalVehicleId', 'InputText', text('የፌዴራል ተሽከርካሪ መለያ (ካለ)', 'Federal vehicle id (if any)'), {
            required: false,
            maxLength: 40
        }),
        fileFact('plate', 'InputText', text('ተሽከርካሪው የያዘው ሰሌዳ', 'The plate it carries'), { maxLength: 40 }),
        fileFact('plateSince', 'EthDate', text('ሰሌዳውን የያዘበት ቀን (ፋይሉ ከገለጸ)', 'Carried since (if the file says)'), {
            required: false
        }),
        fileFact('libreNumber', 'InputText', text('የሊብሬ ቁጥር (ካለ)', 'Libre number (if any)'), {
            required: false,
            maxLength: 40
        }),
        fileFact('libreIssuedOn', 'EthDate', text('ሊብሬው የተሰጠበት ቀን', 'Libre issued on'), { required: false }),
        ...reused(FACTS)
    ]
};

/**
 * MIG-01: the clerk captures, a second person verifies against the paper file (never the one who captured it), and the vehicle joins
 * the register, marked as migrated. A capture that does not match the paper goes back to the clerk with the reason.
 */
export const backCaptureFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('verification', text('ከወረቀቱ ጋር ማረጋገጥ', 'Verification against the paper file'), 'competency.officer', 5, {
            separationOfDuties: ['draft']
        }),
        { key: 'captured', kind: 'end', label: text('ተመዝግቧል', 'Captured') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'verification', action: 'submit', effects: [B.checkBackCapture] },
        {
            from: 'draft',
            to: 'verification',
            action: 'correct',
            label: text('አስተካክለህ አስገባ', 'Correct and resubmit'),
            amendsRequest: true,
            effects: [B.checkBackCapture]
        },
        {
            from: 'verification',
            to: 'draft',
            action: 'return',
            label: text('ለማስተካከያ መልስ', 'Return for correction'),
            commentRequired: true
        },
        {
            from: 'verification',
            to: 'captured',
            action: 'verify',
            label: text('ከወረቀቱ ጋር ይመሳሰላል፤ መዝግብ', 'Matches the paper file: register it'),
            effects: [B.backCaptureVehicle]
        },
        WITHDRAW,
        {
            from: 'verification',
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true
        }
    ]
});

/** MIG-01 at the region's root. Needs the catalogue seeded first. Returns how many services changed. */
export async function importBackCaptureService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = BACK_CAPTURE_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የወረቀት ተሽከርካሪ ፋይል ምዝገባ', 'Back-capture of a paper vehicle file');
    const form = await publishedForm(tx, root, 'vehicle-back-capture', name, BACK_CAPTURE_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'vehicle-back-capture', name, backCaptureFlow()),
        feeRuleVersionId: null
    });
    return 1;
}
