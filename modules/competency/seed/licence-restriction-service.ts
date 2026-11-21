/**
 * The suspension and cancellation record of a driver licence (DVC-21, ADR-0064 §6, task 1.6c) as configuration: its form and its
 * workflow, and nothing else. An officer files the deciding authority's decision (its reference and its scan) against a licence; the
 * team leader, never the one who filed it, approves it against the decision, and only then does it join the register. ITRMS records a
 * decision, it never makes one. No fee: the record is the office's work. Like the other services it only ever makes a first version,
 * and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';

import { AUTHORITY_REFERENCE_MAX, LICENCE_RESTRICTION_EFFECTS as L, LICENCE_RESTRICTION_SERVICE } from '../contracts';
import {
    ACTIONS,
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

/** A fact of the decision: internal, not personal. */
const decisionFact = (id: string, type: string, label: ReturnType<typeof text>, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

const choice = (
    id: string,
    label: ReturnType<typeof text>,
    options: { value: string; label: ReturnType<typeof text> }[]
) => field(id, 'Dropdown', label, {}, { classification: 'internal', data: { dataSource: { staticData: options } } });

/**
 * The record, filed from the decision: the licence from the register, what was decided and by whom, its reference and days, the scan.
 * A suspension's last day is required by the effect's check (a cancellation has none).
 */
export const LICENCE_RESTRICTION_FORM = {
    schemaVersion: 2,
    fields: [
        field('licence', 'RegistryLookup', text('መንጃ ፈቃድ', 'Driver licence'), { provider: 'driver-licence' }),
        choice('kind', text('የውሳኔው ዓይነት', 'What was decided'), [
            { value: 'suspension', label: text('እገዳ', 'Suspension') },
            { value: 'cancellation', label: text('ስረዛ', 'Cancellation') }
        ]),
        choice('authority', text('ውሳኔውን የሰጠው አካል', 'Deciding authority'), [
            { value: 'court', label: text('ፍርድ ቤት', 'Court') },
            { value: 'traffic_police', label: text('የትራፊክ ፖሊስ', 'Traffic police') },
            { value: 'penalty_system', label: text('የቅጣት ሥርዓት', 'Penalty system') },
            { value: 'licensing_body', label: text('ፈቃድ ሰጪ አካል', 'Licensing body') }
        ]),
        decisionFact('authorityReference', 'InputText', text('የውሳኔው ማጣቀሻ ቁጥር', 'Decision reference'), {
            maxLength: AUTHORITY_REFERENCE_MAX
        }),
        decisionFact('decidedOn', 'EthDate', text('ውሳኔው የተሰጠበት ቀን', 'Decided on')),
        decisionFact('startsOn', 'EthDate', text('የሚጀምርበት ቀን', 'Starts on')),
        decisionFact('endsOn', 'EthDate', text('የሚያበቃበት ቀን (ለእገዳ)', 'Last day (a suspension)'), { required: false }),
        field('decisionScan', 'FileUpload', text('የተቃኘው ውሳኔ', 'The scanned decision'), { required: true })
    ]
};

/**
 * DVC-21: the officer files, the team leader approves against the decision (never the one who filed it), and the restriction joins the
 * register; a cancellation ends the licence and revokes its card. A record that does not match the decision goes back with the reason.
 */
export const licenceRestrictionFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('approval', text('ከውሳኔው ጋር ማረጋገጥ', 'Approval against the decision'), 'competency.lead', 3, {
            separationOfDuties: ['draft']
        }),
        { key: 'recorded', kind: 'end', label: text('ተመዝግቧል', 'Recorded') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'approval', action: 'submit', effects: [L.checkLicenceRestriction] },
        {
            from: 'draft',
            to: 'approval',
            action: 'correct',
            label: text('አስተካክለህ አስገባ', 'Correct and resubmit'),
            amendsRequest: true,
            effects: [L.checkLicenceRestriction]
        },
        {
            from: 'approval',
            to: 'draft',
            action: 'return',
            label: ACTIONS.returnIt,
            commentRequired: true
        },
        {
            from: 'approval',
            to: 'recorded',
            action: 'approve',
            label: text('ከውሳኔው ጋር ይመሳሰላል፤ መዝግብ', 'Matches the decision: record it'),
            effects: [L.recordLicenceRestriction]
        },
        WITHDRAW,
        {
            from: 'approval',
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true
        }
    ]
});

/** DVC-21 at the region's root. Needs the catalogue seeded first. Returns how many services changed. */
export async function importLicenceRestrictionService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = LICENCE_RESTRICTION_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የመንጃ ፈቃድ እገዳና ስረዛ መዝገብ', 'Driver licence suspension and cancellation record');
    const form = await publishedForm(tx, root, 'licence-restriction', name, LICENCE_RESTRICTION_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'licence-restriction', name, licenceRestrictionFlow()),
        feeRuleVersionId: null
    });
    return 1;
}
