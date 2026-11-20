/**
 * The back-capture of a paper driver licence (MIG-02, ADR-0054, task 1.6b) as configuration: its form and its workflow, and nothing
 * else. A clerk captures the paper licence's facts and its scan; a second person checks them against the paper and verifies, and only
 * then does the licence join the register, with the number and the card serial printed on it. A printed number that cannot be kept
 * (inside the region's reserved range, or another licence's) is flagged to the bureau by the second person, never renumbered. No fee:
 * the migration is the office's work. Like the other services it only ever makes a first version, and leaves what a bureau has
 * published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';

import {
    CARD_SERIAL_MAX,
    LICENCE_CAPTURE_EFFECTS as L,
    LICENCE_CAPTURE_SERVICE,
    PAPER_LICENCE_NUMBER_MAX
} from '../contracts';
import { LICENCE_GRADES } from './grades';
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

/** A fact of the paper file: internal, not personal. */
const fileFact = (id: string, type: string, label: ReturnType<typeof text>, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/**
 * The capture, filed by a clerk from the paper licence: the holder from the register of people, the number and the card serial as
 * printed, its kind and days, the office that issued it, its grades. The scan is required: the second person checks against it.
 */
export const LICENCE_CAPTURE_FORM = {
    schemaVersion: 2,
    fields: [
        fileFact('paperReference', 'InputText', text('የወረቀት ፋይል ቁጥር', 'Paper file reference'), { maxLength: 60 }),
        field('paperFileScan', 'FileUpload', text('የተቃኘው የወረቀት ፈቃድ', 'The scanned paper licence'), { required: true }),
        field('person', 'RegistryLookup', text('የፈቃዱ ባለቤት', 'Licence holder'), { provider: 'person' }),
        field('number', 'InputText', text('በፈቃዱ ላይ የታተመው ቁጥር', 'Number printed on the licence'), {
            maxLength: PAPER_LICENCE_NUMBER_MAX
        }),
        field('cardSerial', 'InputText', text('የካርድ ሴሪ ቁጥር (ካለ)', 'Card serial (if any)'), {
            required: false,
            maxLength: CARD_SERIAL_MAX
        }),
        field(
            'kind',
            'Dropdown',
            text('የፈቃዱ ዓይነት', 'Licence kind'),
            {},
            {
                classification: 'internal',
                data: {
                    dataSource: {
                        staticData: [
                            { value: 'temporary', label: text('ጊዜያዊ', 'Temporary') },
                            { value: 'permanent', label: text('ቋሚ', 'Permanent') }
                        ]
                    }
                }
            }
        ),
        fileFact('issuedOn', 'EthDate', text('የተሰጠበት ቀን', 'Issued on')),
        fileFact('validUntil', 'EthDate', text('የሚያበቃበት ቀን', 'Valid until')),
        fileFact('issuedBy', 'InputText', text('የሰጠው ጽ/ቤት (ፈቃዱ ከገለጸ)', 'Issuing office (if the licence says)'), {
            required: false,
            maxLength: 120
        }),
        field(
            'grades',
            'FormArray',
            text('የፈቃዱ ደረጃዎች', 'Licence grades'),
            {
                minItems: 1,
                maxItems: 8,
                itemLabel: text('ደረጃ', 'Grade'),
                addButtonLabel: text('ደረጃ ጨምር', 'Add a grade')
            },
            { category: 'Layout', classification: 'internal', layout: { options: { isContainer: true } } }
        ),
        field(
            'grade',
            'Dropdown',
            text('ደረጃ', 'Grade'),
            {},
            {
                parentId: 'grades',
                classification: 'internal',
                data: { dataSource: { staticData: LICENCE_GRADES.map((g) => ({ label: g.name, value: g.key })) } }
            }
        ),
        field(
            'permanentSince',
            'EthDate',
            text('ቋሚ የሆነበት ቀን (ፈቃዱ ከገለጸ)', 'Permanent since (if the licence says)'),
            { required: false },
            { parentId: 'grades', classification: 'internal' }
        )
    ]
};

/**
 * MIG-02: the clerk captures, a second person verifies against the paper licence (never the one who captured it), and the licence joins
 * the register, marked as migrated. A capture that does not match the paper goes back to the clerk with the reason; a number that
 * cannot be kept is flagged, with the reason, and the case ends there.
 */
export const licenceCaptureFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task(
            'verification',
            text('ከወረቀቱ ጋር ማረጋገጥ', 'Verification against the paper licence'),
            'competency.officer',
            5,
            {
                separationOfDuties: ['draft']
            }
        ),
        { key: 'captured', kind: 'end', label: text('ተመዝግቧል', 'Captured') },
        { key: 'flagged', kind: 'end', label: text('ቁጥሩ ለቢሮው ተጠቁሟል', 'Number flagged to the bureau') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'verification', action: 'submit', effects: [L.checkLicenceCapture] },
        {
            from: 'draft',
            to: 'verification',
            action: 'correct',
            label: text('አስተካክለህ አስገባ', 'Correct and resubmit'),
            amendsRequest: true,
            effects: [L.checkLicenceCapture]
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
            label: text('ከወረቀቱ ጋር ይመሳሰላል፤ መዝግብ', 'Matches the paper licence: register it'),
            effects: [L.captureLicence]
        },
        {
            from: 'verification',
            to: 'flagged',
            action: 'flag',
            label: text('ቁጥሩን ለቢሮው ጠቁም', 'Flag the number to the bureau'),
            commentRequired: true,
            effects: [L.flagLicenceNumber]
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

/** MIG-02 at the region's root. Needs the catalogue and the licence grades seeded first. Returns how many services changed. */
export async function importLicenceCaptureService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = LICENCE_CAPTURE_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የወረቀት መንጃ ፈቃድ ምዝገባ', 'Back-capture of a paper driver licence');
    const form = await publishedForm(tx, root, 'licence-back-capture', name, LICENCE_CAPTURE_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'licence-back-capture', name, licenceCaptureFlow()),
        feeRuleVersionId: null
    });
    return 1;
}
