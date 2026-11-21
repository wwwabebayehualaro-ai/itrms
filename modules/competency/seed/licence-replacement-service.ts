/**
 * The replacement of a driver licence's card (DVC-19, Proclamation 1074/2018 Art. 18, ADR-0064 §5, task 1.6e) as configuration: its
 * request form, its workflow and the fee rule it names, and nothing else. The officer reviews the request (a lost or stolen card's
 * police letter, a damaged or outdated card handed in), the fee is paid, the team leader approves, and the licence's card is issued
 * again with its number kept: the old card document is superseded, the new card goes to print and a temporary permit stands meanwhile
 * (task 1.6d). Like the other services it only ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';

import {
    COMPETENCY_EFFECTS as E,
    DRIVING_PERMIT_EFFECTS,
    LICENCE_REPLACEMENT_EFFECTS as L,
    LICENCE_REPLACEMENT_SERVICE
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
    task,
    text,
    WITHDRAW,
    workflowVersion
} from './service-config';

/** A fact of the request, internal: no person's own data. */
const internal = (id: string, type: string, label: I18nText, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/** The request: the licence, why its card is replaced, what stands for the old card, and the fee. */
export const LICENCE_REPLACEMENT_FORM = {
    schemaVersion: 2,
    fields: [
        internal('licence', 'RegistryLookup', text('መንጃ ፈቃድ', 'Driver licence'), { provider: 'driver-licence' }),
        field(
            'reason',
            'Dropdown',
            text('የምትኩ ምክንያት', 'Why it is replaced'),
            {},
            {
                classification: 'internal',
                data: {
                    dataSource: {
                        staticData: [
                            { value: 'lost', label: text('የጠፋ', 'Lost') },
                            { value: 'stolen', label: text('የተሰረቀ', 'Stolen') },
                            { value: 'damaged', label: text('የተበላሸ', 'Damaged') },
                            { value: 'outdated', label: text('ጊዜ ያለፈበት ካርድ (የድሮ ዓይነት)', 'Outdated card (an old kind)') }
                        ]
                    }
                }
            }
        ),
        internal('policeReportReference', 'InputText', text('የፖሊስ ደብዳቤ ቁጥር', 'Police letter number'), {
            required: false,
            maxLength: 60
        }),
        internal('policeReportOn', 'EthDate', text('የፖሊስ ደብዳቤ ቀን', 'Police letter date'), { required: false }),
        attachment('policeReport', text('የፖሊስ ደብዳቤ', 'Police letter'), 'internal'),
        internal('oldCardHandedIn', 'Checkbox', text('የቀድሞው ካርድ ተመልሷል', 'The old card was handed in'), {
            required: false
        }),
        attachment('holderIdentity', text('የባለፈቃዱ መታወቂያ (ፋይዳ)', "Holder's identity document (Fayda)")),
        FEE
    ]
};

/**
 * DVC-19: review (the officer), payment, approval (the team leader, never who filed or reviewed it), and the card issued again: the
 * old one's document superseded, the new one to print, the permit meanwhile. A replacement is the office's own: it does not go to the
 * national platform (ADR-0064 §6), and the licence keeps its number and term.
 */
export const licenceReplacementFlow = () => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        task('approval', text('የመጨረሻ ማጽደቅ', 'Final approval'), 'competency.lead', 2, {
            separationOfDuties: ['draft', 'review']
        }),
        { key: 'issued', kind: 'end', label: text('ተሰጥቷል', 'Issued') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [L.checkLicenceReplacement] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', L.checkLicenceReplacement]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            effects: ['fees.createPaymentOrder']
        },
        { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        {
            from: 'approval',
            to: 'issued',
            action: 'approve',
            label: ACTIONS.approve,
            guard: PAID,
            // checked again (suspended or cancelled since?), then the card, its print and the permit while it prints
            effects: [
                L.checkLicenceReplacement,
                L.replaceLicenceCard,
                E.addToPrintBatch,
                DRIVING_PERMIT_EFFECTS.issueDrivingPermit
            ]
        },
        WITHDRAW,
        {
            from: ['review', 'approval'],
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true
        }
    ]
});

/** DVC-19 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importLicenceReplacementService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = LICENCE_REPLACEMENT_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የመንጃ ፈቃድ ምትክ', 'Driver licence replacement');
    const form = await publishedForm(tx, root, 'driver-licence-replacement', name, LICENCE_REPLACEMENT_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'driver-licence-replacement',
            name,
            licenceReplacementFlow()
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-19-licence-replacement')
    });
    return 1;
}
