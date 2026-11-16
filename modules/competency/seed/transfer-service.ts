/**
 * The ownership transfer (DVC-13, task 1.4b) as configuration: its request, the four step forms (the committee's valuation, the
 * letters, the papers that come back, the booklet), its workflow and the fee rule it names, and nothing else. The sellers are the
 * register's current owners; the request names the buyers. Like the other services it only ever makes a first version, and leaves
 * what a bureau has published alone.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import {
    OWNERSHIP_TRANSFER_SERVICE,
    REGISTRATION_CERTIFICATE_TEMPLATE,
    REGISTRATION_EFFECTS as R,
    TRANSFER_ACQUIRED_BY,
    TRANSFER_EFFECTS as T,
    TRANSFER_LETTER_COUNTER,
    TRANSFER_LETTER_PATTERN
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
import { LIBRE_BOOKLET_FORM } from './vehicle-services';

const words = (key: string): I18nText => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/** A fact of the transfer, internal: no person's own data. */
const internal = (id: string, type: string, label: I18nText, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/** A whole-Birr figure of the valuation: the service checks its range again and keeps it in santim. */
const birr = (id: string, label: I18nText, required: boolean) =>
    internal(id, 'InputNumber', label, { required, min: 1, max: 10_000_000_000 });

/**
 * The request, filed at the counter: the vehicle from the register, the buyers (the sellers are the register's current owners)
 * and how they came by it. The contract, the identity documents and the libre are kept as attachments, not required: an office with
 * no scanner still works, and the officer who reviews a case sees the paper.
 */
export const OWNERSHIP_TRANSFER_FORM = {
    schemaVersion: 2,
    fields: [
        internal('vehicle', 'RegistryLookup', text('ተሽከርካሪ', 'Vehicle'), { provider: 'vehicle' }),
        field(
            'owners',
            'FormArray',
            text('አዲሶቹ ባለቤቶች (ገዢዎች)', 'New owners (buyers)'),
            {
                minItems: 1,
                maxItems: 5,
                itemLabel: text('ባለቤት', 'Owner'),
                addButtonLabel: text('ባለቤት ጨምር', 'Add an owner')
            },
            { category: 'Layout', layout: { options: { isContainer: true } } }
        ),
        field(
            'ownerPerson',
            'RegistryLookup',
            text('ባለቤት (ሰው)', 'Owner (a person)'),
            { provider: 'person', required: false },
            { parentId: 'owners' }
        ),
        field(
            'ownerOrganisation',
            'RegistryLookup',
            text('ባለቤት (ድርጅት)', 'Owner (an organisation)'),
            { provider: 'organisation', required: false },
            { parentId: 'owners' }
        ),
        field(
            'acquiredBy',
            'Dropdown',
            text('ባለቤትነቱ የተላለፈበት መንገድ', 'How the buyers came by the vehicle'),
            {},
            {
                classification: 'internal',
                data: {
                    dataSource: {
                        staticData: TRANSFER_ACQUIRED_BY.map((a) => ({
                            label: words(`vehicles.acquiredBy.${a}`),
                            value: a
                        }))
                    }
                }
            }
        ),
        attachment('saleContract', text('የሽያጭ ወይም የስጦታ ውል', 'Sale or gift contract'), 'internal'),
        attachment('sellerIdentity', text('የሻጩ መታወቂያ', "Seller's identity document")),
        attachment('buyerIdentity', text('የገዢው መታወቂያ', "Buyer's identity document")),
        attachment('libreCopy', text('የሊብሬ ቅጂ', 'Copy of the libre'), 'internal'),
        attachment('courtDecision', text('የፍርድ ቤት ውሳኔ', 'Court decision'), 'internal'),
        attachment('powerOfAttorney', text('የውክልና ሰነድ', 'Power of attorney')),
        FEE
    ]
};

/**
 * The valuation step: whether the vehicle is as the paper inspection says, and what the committee set. Whole Birr, kept in santim;
 * ITRMS works out no duty or tax from them (the revenue office does).
 */
export const TRANSFER_VALUATION_FORM = {
    schemaVersion: 2,
    fields: [
        internal(
            'inspectionMatches',
            'Checkbox',
            text('ተሽከርካሪው ከወረቀት የምርመራ ቅጹ ጋር ይመሳሰላል', 'The vehicle matches its paper inspection')
        ),
        internal('inspectionNote', 'InputTextarea', text('የምርመራ ማስታወሻ', 'Inspection note'), {
            required: false,
            maxLength: 500
        }),
        birr('purchasePriceBirr', text('የግዢ ዋጋ (ብር)', 'Purchase price (Birr)'), false),
        birr('marketValueBirr', text('የገበያ ዋጋ (ብር)', 'Market value (Birr)'), false),
        birr('contractValueBirr', text('በውሉ የተጠቀሰ ዋጋ (ብር)', 'Value stated in the contract (Birr)'), false),
        internal('depreciationPercent', 'InputNumber', text('የዋጋ ቅናሽ (%)', 'Depreciation (%)'), {
            required: false,
            min: 0,
            max: 100
        }),
        birr('committeeValueBirr', text('ኮሚቴው የወሰነው ዋጋ (ብር)', 'Value set by the committee (Birr)'), true),
        internal('valuers', 'InputText', text('የገማቾች ስም', 'Valuers'), { required: false, maxLength: 200 })
    ]
};

/**
 * The letters step: the offices the letters go to. Only the revenue office is always asked; the service requires the justice office
 * for a sale or a gift and the tax office for a commercial vehicle (code 3).
 */
export const TRANSFER_LETTERS_FORM = {
    schemaVersion: 2,
    fields: [
        internal(
            'justiceOffice',
            'InputText',
            text('የፍትሕ ጽ/ቤት (ለሽያጭና ለስጦታ)', 'Justice office (for a sale or a gift)'),
            { required: false, maxLength: 120 }
        ),
        internal('revenueOffice', 'InputText', text('የገቢዎች ጽ/ቤት', 'Revenue office'), { maxLength: 120 }),
        internal('taxOffice', 'InputText', text('የግብር ጽ/ቤት (ለኮድ 3 ተሽከርካሪ)', 'Tax office (for a code-3 vehicle)'), {
            required: false,
            maxLength: 120
        })
    ]
};

/**
 * The papers that came back: the authenticated contract (a sale or a gift), the court's reference (an inheritance or a court order),
 * the stamp duty receipt the revenue office gave and the tax registration (a code-3 vehicle). No amounts: the receipt is the proof.
 */
export const TRANSFER_EVIDENCE_FORM = {
    schemaVersion: 2,
    fields: [
        internal('contractReference', 'InputText', text('የተረጋገጠው ውል ማጣቀሻ', 'Authenticated contract reference'), {
            required: false,
            maxLength: 60
        }),
        internal('contractAuthenticatedOn', 'EthDate', text('ውሉ የተረጋገጠበት ቀን', 'Contract authenticated on'), {
            required: false
        }),
        internal('authenticatedContract', 'FileUpload', text('የተረጋገጠው ውል', 'Authenticated contract'), {
            required: false
        }),
        internal('stampDutyReceipt', 'InputText', text('የቴምብር ቀረጥ ደረሰኝ ቁጥር', 'Stamp duty receipt number'), {
            maxLength: 60
        }),
        internal('stampDutyPaidOn', 'EthDate', text('ቀረጡ የተከፈለበት ቀን', 'Stamp duty paid on')),
        internal('stampDutyReceiptFile', 'FileUpload', text('የቴምብር ቀረጥ ደረሰኝ', 'Stamp duty receipt'), {
            required: false
        }),
        internal(
            'taxRegistrationReference',
            'InputText',
            text('የግብር ምዝገባ ማጣቀሻ (ለኮድ 3 ተሽከርካሪ)', 'Tax registration reference (for a code-3 vehicle)'),
            { required: false, maxLength: 60 }
        ),
        internal(
            'courtReference',
            'InputText',
            text('የፍርድ ቤት ማጣቀሻ (ለውርስና ለፍርድ ቤት ትዕዛዝ)', 'Court reference (for an inheritance or a court order)'),
            { required: false, maxLength: 60 }
        )
    ]
};

/** Every state that can still be rejected: the filing, then each step before the owners change. */
const REJECTABLE = ['review', 'valuation', 'letters', 'outside', 'approval', 'transfer'];

/** The check that refuses the service while the vehicle is encumbered, named on filing and before each step that moves on (task 1.4a). */
const ENC = 'vehicles.checkEncumbrances:ownership-transfer';

/**
 * DVC-13: review, the committee's valuation by an inspector, the letters, the papers that come back, payment, final approval, then
 * the owners change in the register and the booklet is written. Each step that moves the case on checks the vehicle for a hold
 * again, so one recorded in between still stops it. Separation of duties: nobody values the case they filed, nobody approves a
 * case they worked, and the approver does not do the transfer. A rejection withdraws the letters.
 */
export const ownershipTransferFlow = (
    valuationForm: string,
    lettersForm: string,
    evidenceForm: string,
    bookletForm: string
) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        task('valuation', text('የዋጋ ግምት', 'Valuation'), 'competency.inspector', 3, {
            stepForm: valuationForm,
            separationOfDuties: ['draft']
        }),
        task('letters', text('ደብዳቤዎችን መጻፍ', 'Letters to the other offices'), 'competency.officer', 1, {
            stepForm: lettersForm
        }),
        task(
            'outside',
            text('የተረጋገጠውን ውልና ደረሰኞችን በመጠበቅ ላይ', 'Waiting for the authenticated contract and the receipts'),
            'competency.officer',
            30,
            { stepForm: evidenceForm }
        ),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        {
            key: 'approval',
            kind: 'task',
            label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['draft', 'review', 'valuation', 'outside'],
            sla: { businessDays: 2 }
        },
        task('transfer', text('ባለቤትነት ማስተላለፍ', 'Ownership transfer'), 'competency.officer', 1, {
            separationOfDuties: ['approval']
        }),
        task('booklet', text('የሊብሬ ደብተር መስጠት', 'Libre booklet'), 'competency.officer', 30, {
            stepForm: bookletForm
        }),
        { key: 'transferred', kind: 'end', label: text('ባለቤትነቱ ተላልፏል', 'Ownership transferred') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [T.checkOwnershipTransfer, ENC] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', T.checkOwnershipTransfer, ENC]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        { from: 'review', to: 'valuation', action: 'approve', label: ACTIONS.approve, effects: [ENC] },
        { from: 'valuation', to: 'review', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'valuation',
            to: 'letters',
            action: 'value',
            label: text('ግምቱን መዝግብ', 'Record the valuation'),
            effects: [T.recordValuation]
        },
        {
            from: 'letters',
            to: 'outside',
            action: 'issue_letters',
            label: text('ደብዳቤዎቹን ስጥ', 'Issue the letters'),
            effects: [T.checkOwnershipTransfer, ENC, T.issueTransferLetters]
        },
        {
            from: 'outside',
            to: 'payment',
            action: 'approve',
            label: text('ወረቀቶቹን መዝግብ', 'Record the papers'),
            effects: [T.recordTransferEvidence, ENC, 'fees.createPaymentOrder']
        },
        { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        {
            from: 'approval',
            to: 'transfer',
            action: 'approve',
            label: ACTIONS.approve,
            guard: PAID,
            effects: [ENC]
        },
        {
            from: 'transfer',
            to: 'booklet',
            action: 'transfer',
            label: text('ባለቤትነቱን አስተላልፍ', 'Transfer the ownership'),
            guard: PAID,
            effects: [ENC, `${T.transferOwnership}:${REGISTRATION_CERTIFICATE_TEMPLATE}`]
        },
        {
            from: 'booklet',
            to: 'transferred',
            action: 'issue_booklet',
            label: text('ደብተሩን ስጥ', 'Issue the booklet'),
            guard: PAID,
            effects: [R.issueLibreBooklet]
        },
        // the vehicle left the register or took another libre while the case waited: closed with the reason, no booklet
        {
            from: 'booklet',
            to: 'transferred',
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
            commentRequired: true,
            // the letters written for the case no longer stand
            effects: [T.revokeTransferLetters]
        }
    ]
});

/** The transfer letters' counter at every office that offers DVC-13. Returns how many offices have it. */
export async function setUpTransferLetterCounters(
    tx: Tx,
    regionId: string,
    pattern = TRANSFER_LETTER_PATTERN
): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = ${OWNERSHIP_TRANSFER_SERVICE}`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: TRANSFER_LETTER_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

/** DVC-13 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importOwnershipTransferService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = OWNERSHIP_TRANSFER_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የባለቤትነት (ስም) ዝውውር', 'Ownership transfer');
    const valuation = await publishedForm(
        tx,
        root,
        'vehicle-transfer-valuation',
        text('የዝውውር ዋጋ ግምት', 'Transfer valuation'),
        TRANSFER_VALUATION_FORM
    );
    const letters = await publishedForm(
        tx,
        root,
        'vehicle-transfer-letters',
        text('የዝውውር ደብዳቤዎች', 'Transfer letters'),
        TRANSFER_LETTERS_FORM
    );
    const evidence = await publishedForm(
        tx,
        root,
        'vehicle-transfer-evidence',
        text('የዝውውር ማስረጃዎች', 'Transfer papers'),
        TRANSFER_EVIDENCE_FORM
    );
    // the libre booklet's own form, shared with the new registration
    const booklet = await publishedForm(
        tx,
        root,
        'vehicle-libre-booklet',
        text('የሊብሬ ደብተር', 'Libre booklet'),
        LIBRE_BOOKLET_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-ownership-transfer', name, OWNERSHIP_TRANSFER_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-ownership-transfer',
            name,
            ownershipTransferFlow(
                `vehicle-transfer-valuation@${valuation.number}`,
                `vehicle-transfer-letters@${letters.number}`,
                `vehicle-transfer-evidence@${evidence.number}`,
                `vehicle-libre-booklet@${booklet.number}`
            )
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-13-ownership-transfer')
    });
    return 1;
}
