/**
 * The replacement of a lost, stolen or damaged libre, bolo sticker or plate (DVC-06, task 1.5, ADR-0062) as configuration: its
 * request form, its workflow and the fee rule it names, and nothing else. Part 1 offers the libre only; the bolo sticker (1.5b) and
 * the plate (1.5c) add their choices, states and steps as a new version of the form and the flow. Like the other services it only
 * ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import { VEHICLE_USES } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    REGISTRATION_CERTIFICATE_TEMPLATE,
    REGISTRATION_EFFECTS as R,
    REPLACEMENT_EFFECTS as X,
    REPLACEMENT_SERVICE
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
import { LIBRE_BOOKLET_FORM } from './vehicle-services';

const words = (key: string): I18nText => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/** A fact of the request, internal: no person's own data. */
const internal = (
    id: string,
    type: string,
    label: I18nText,
    props: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
) => field(id, type, label, props, { classification: 'internal', ...extra });

const choice = (id: string, label: I18nText, options: readonly { value: string; label: I18nText }[]) =>
    internal(
        id,
        'Dropdown',
        label,
        {},
        {
            data: { dataSource: { staticData: options.map((o) => ({ label: o.label, value: o.value })) } }
        }
    );

/**
 * The request, filed at the counter: the vehicle from the register, what is replaced (a libre for now) and why, the vehicle's use
 * (the fee is worked out from it, and the check compares it with the register), the police letter of a lost or stolen item and the
 * newspaper notice of a lost or stolen libre. The letter, the clipping and the owner's identity are kept as attachments, not
 * required: an office with no scanner still works, and the officer who reviews a case sees the paper.
 */
export const REPLACEMENT_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'vehicle' }),
        choice('item', text('የሚተካው ሰነድ', 'What is replaced'), [{ value: 'libre', label: text('ሊብሬ', 'Libre') }]),
        choice('reason', text('የምትኩ ምክንያት', 'Why it is replaced'), [
            { value: 'lost', label: text('የጠፋ', 'Lost') },
            { value: 'stolen', label: text('የተሰረቀ', 'Stolen') },
            { value: 'damaged', label: text('የተበላሸ', 'Damaged') }
        ]),
        choice(
            'use',
            text('አገልግሎት', 'Use'),
            VEHICLE_USES.map((u) => ({ value: u, label: words(`vehicles.use.${u}`) }))
        ),
        internal('policeReportReference', 'InputText', text('የፖሊስ ደብዳቤ ቁጥር', 'Police letter number'), {
            required: false,
            maxLength: 60
        }),
        internal('policeReportOn', 'EthDate', text('የፖሊስ ደብዳቤ ቀን', 'Police letter date'), { required: false }),
        attachment('policeReport', text('የፖሊስ ደብዳቤ', 'Police letter'), 'internal'),
        internal('noticeNewspaper', 'InputText', text('ማስታወቂያው የወጣበት ጋዜጣ', 'Newspaper of the notice'), {
            required: false,
            maxLength: 120
        }),
        internal('noticePublishedOn', 'EthDate', text('ማስታወቂያው የታተመበት ቀን', 'Day the notice was published'), {
            required: false
        }),
        attachment('noticeClipping', text('የጋዜጣ ማስታወቂያ ቅጂ', 'Copy of the newspaper notice'), 'internal'),
        internal('oldItemHandedIn', 'Checkbox', text('የተበላሸው ሰነድ ተመልሷል', 'The damaged item was handed in'), {
            required: false
        }),
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', 'Owner identity document')),
        FEE
    ]
};

/** The check that refuses the service while the vehicle carries a hold that blocks a replacement (the vehicles slice's, task 1.4a). */
const ENC = 'vehicles.checkEncumbrances:replacement';
const ITEM = (item: string) => ({ fact: 'replacement.item', op: 'eq', value: item });
const NOTICE = { fact: 'replacement.noticeRequired', op: 'eq', value: true };

/** Every state that can still be rejected: the review, the notice period, the approval and the replacement. */
const REJECTABLE = ['review', 'notice', 'approval', 'libre'];

/**
 * DVC-06 for a libre: review (the police letter and the notice are checked on filing), a lost or stolen libre waits out its
 * newspaper notice (the officer takes the step on or after the day, which the effect checks: the workflow counts business days
 * only), payment, final approval, then the libre in force leaves force and the new libre is issued with its certificate, and the
 * booklet is written as for a new libre. A damaged libre skips the notice. Each step that moves the case on checks the vehicle for
 * a hold again. Separation of duties: nobody approves a case they filed, reviewed or released from its notice, and the approver
 * does not replace the libre.
 */
export const replacementFlow = (bookletForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        task(
            'notice',
            text('የጋዜጣ ማስታወቂያ ጊዜ በመጠበቅ ላይ', 'Waiting for the newspaper notice period'),
            'competency.officer',
            // monitoring only: the notice period is 15 calendar days, checked by the effect
            15
        ),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        {
            key: 'approval',
            kind: 'task',
            label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['draft', 'review', 'notice'],
            sla: { businessDays: 2 }
        },
        task('libre', text('ሊብሬ መተካት', 'Libre replacement'), 'competency.officer', 1, {
            separationOfDuties: ['approval']
        }),
        task('booklet', text('የሊብሬ ደብተር መስጠት', 'Libre booklet'), 'competency.officer', 30, {
            stepForm: bookletForm
        }),
        { key: 'replaced', kind: 'end', label: text('ተተክቷል', 'Replaced') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [X.checkReplacement, ENC] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', X.checkReplacement, ENC]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        // a lost or stolen libre waits out its notice; a damaged one goes to payment
        { from: 'review', to: 'notice', action: 'approve', label: ACTIONS.approve, guard: NOTICE, effects: [ENC] },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            guard: ITEM('libre'),
            effects: [ENC, 'fees.createPaymentOrder']
        },
        {
            from: 'notice',
            to: 'payment',
            action: 'notice_over',
            label: text('የማስታወቂያው ጊዜ አልቋል', 'The notice period is over'),
            effects: [X.checkReplacementNotice, ENC, 'fees.createPaymentOrder']
        },
        { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        {
            from: 'approval',
            to: 'libre',
            action: 'approve',
            label: ACTIONS.approve,
            guard: { all: [PAID, ITEM('libre')] },
            effects: [ENC]
        },
        {
            from: 'libre',
            to: 'booklet',
            action: 'replace_libre',
            label: text('ሊብሬውን ተካ', 'Replace the libre'),
            guard: PAID,
            effects: [ENC, `${X.replaceLibre}:${REGISTRATION_CERTIFICATE_TEMPLATE}`]
        },
        {
            from: 'booklet',
            to: 'replaced',
            action: 'issue_booklet',
            label: text('ደብተሩን ስጥ', 'Issue the booklet'),
            guard: PAID,
            effects: [ENC, R.issueLibreBooklet]
        },
        // the vehicle left the register or took another libre while the case waited: closed with the reason, no booklet
        {
            from: 'booklet',
            to: 'replaced',
            action: 'close_without_booklet',
            label: text('ያለ ደብተር ዝጋ', 'Close without a booklet'),
            commentRequired: true
        },
        WITHDRAW,
        {
            from: REJECTABLE,
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true
        }
    ]
});

/** DVC-06 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importReplacementService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = REPLACEMENT_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    const name = text('የጠፋ፣ የተሰረቀ ወይም የተበላሸ ሰነድ ምትክ', 'Replacement of a lost, stolen or damaged document');
    // the libre booklet's own form, shared with the new registration
    const booklet = await publishedForm(
        tx,
        root,
        'vehicle-libre-booklet',
        text('የሊብሬ ደብተር', 'Libre booklet'),
        LIBRE_BOOKLET_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-replacement', name, REPLACEMENT_FORM);
    const flow = replacementFlow(`vehicle-libre-booklet@${booklet.number}`);
    // seeded by an earlier release: the seed's own version moves to today's flow and form (the bureau's own is never touched)
    if (service.currentVersionId)
        return (await supersedeSeededVersion(tx, root, service, 'vehicle-replacement', flow, {
            key: 'vehicle-replacement',
            document: REPLACEMENT_FORM
        }))
            ? 1
            : 0;
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(tx, root, 'vehicle-replacement', name, flow),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-06-replacement')
    });
    return 1;
}
