/**
 * The two licence services as configuration (task 0.24b): their forms, workflows and fee rules, and nothing else. No code here decides
 * anything; a bureau can change any of it the way it changes any service. It is an installation step, as the fee rules are: the bureau
 * reviews what it inherits, and a second person's approval is for what it changes. It only ever makes a service's first version: run
 * again, it leaves what a bureau has published alone.
 */
import { and, desc, eq } from 'drizzle-orm';
import { contentHash, insertAudited, updateAudited, type Tx } from '@itrms/kernel/db';
import { feeRuleApprovals, feeRules, feeRuleVersions } from '@itrms/fees/api';
import { formDefinitions, formVersions } from '@itrms/forms/api';
import { serviceDefinitions, serviceVersions } from '@itrms/services/api';
import { workflowDefinitions, workflowDefinitionVersions } from '@itrms/workflow/api';
import { workflowDefinitionSchema, type I18nText } from '@itrms/schemas';

import { addisDay, COMPETENCY_EFFECTS as E, NATIONAL_ACCEPTED, NATIONAL_ACTOR, NATIONAL_REJECTED } from '../contracts';
import { LICENCE_GRADES } from './grades';

const text = (am: string, en: string): I18nText => ({ am, en });

const field = (
    id: string,
    type: string,
    label: I18nText,
    props: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
) => ({
    id,
    type,
    label,
    classification: 'personal',
    props: { required: true, ...props },
    behavior: { validation: { supported: true } },
    ...extra
});

const FEE = { id: 'fee', type: 'Fee', category: 'Data', label: text('ክፍያ', 'Fee'), props: { showLines: true } };

const GRADE = field(
    'grade',
    'Dropdown',
    text('የፈቃድ ደረጃ', 'Licence grade'),
    {},
    {
        data: {
            dataSource: { staticData: LICENCE_GRADES.map((g) => ({ label: g.name, value: g.key })) }
        }
    }
);

const MEDICAL = [
    field('medicalFacility', 'InputText', text('የህክምና ተቋም', 'Medical facility')),
    field('medicalExaminedOn', 'EthDate', text('የህክምና ምርመራ ቀን', 'Date of the medical examination'))
];

/**
 * The documents of Art. 14(2) are kept as attachments, not required: the officer who reviews a case sees the paper, and an office with
 * no scanner still works. An office's forms can require them.
 */
const attachment = (id: string, label: I18nText, classification = 'personal') =>
    field(id, 'FileUpload', label, { required: false }, { classification });

export const NEW_LICENCE_FORM = {
    schemaVersion: 2,
    fields: [
        field('person', 'RegistryLookup', text('አመልካች', 'Applicant'), { provider: 'person' }),
        GRADE,
        field('educationGrade', 'InputNumber', text('የተጠናቀቀ የትምህርት ክፍል', 'School grade completed'), {
            min: 0,
            max: 20
        }),
        field('school', 'RegistryLookup', text('የማሰልጠኛ ተቋም', 'Training school'), { provider: 'training-school' }),
        ...MEDICAL,
        attachment('educationCertificate', text('የትምህርት ማስረጃ', 'Education certificate')),
        attachment(
            'identityDocument',
            text('የልደት ማስረጃ፣ ፓስፖርት ወይም የቀበሌ መታወቂያ', 'Birth certificate, passport or kebele ID')
        ),
        attachment('medicalCertificate', text('የህክምና ማስረጃ', 'Medical certificate'), 'sensitive'),
        attachment('trainingCertificate', text('የሥልጠና ማስረጃ', 'Training certificate')),
        FEE
    ]
};

export const RENEWAL_FORM = {
    schemaVersion: 2,
    fields: [
        field('licence', 'RegistryLookup', text('መንጃ ፈቃድ', 'Driver licence'), { provider: 'driver-licence' }),
        // these two work the fee out when the request is filed; on submit they must agree with the register
        GRADE,
        field('expiry', 'EthDate', text('ፈቃዱ የሚያበቃበት ቀን', 'The licence’s expiry date')),
        field('lost', 'Checkbox', text('ካርዱ ጠፍቷል', 'The card was lost'), { required: false }),
        ...MEDICAL,
        attachment('medicalCertificate', text('የህክምና ማስረጃ', 'Medical certificate'), 'sensitive'),
        FEE
    ]
};

export const EXAM_FORM = {
    schemaVersion: 2,
    fields: [
        field('heldOn', 'EthDate', text('የፈተና ቀን', 'Exam date')),
        field('theory', 'InputNumber', text('የንድፈ ሀሳብ ውጤት', 'Theory score'), { required: false, min: 0, max: 100 }),
        field('practical', 'InputNumber', text('የተግባር ውጤት', 'Practical score'), { required: false, min: 0, max: 100 }),
        field('passed', 'Checkbox', text('አልፏል', 'Passed'), { required: false })
    ]
};

const task = (key: string, label: I18nText, role: string, businessDays: number, extra: object = {}) => ({
    key,
    kind: 'task',
    label,
    assignee: { role, unit: 'handling' },
    sla: { businessDays },
    ...extra
});

const PAID = { fact: 'payment.settled', op: 'eq', value: true };
const REJECT_ROLES = ['competency.officer', 'competency.lead'];

const ACTIONS = {
    approve: text('አጽድቅ', 'Approve'),
    pass: text('አልፏል', 'Passed'),
    fail: text('ወድቋል፣ እንደገና ይፈተን', 'Failed, to retake'),
    returnIt: text('ለማስተካከያ መልስ', 'Return for correction'),
    correct: text('አስተካክለህ አስገባ', 'Correct and resubmit')
};

/** What both services share from the payment on: it gives the licence only while the fee stands paid (ADR-0042). */
const finish = (send: readonly string[], given: readonly string[]) => [
    { from: 'payment', to: 'approval', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
    { from: 'payment', to: 'rejected', on: 'timeout' },
    {
        from: 'approval',
        to: 'national',
        action: 'approve',
        label: ACTIONS.approve,
        guard: PAID,
        effects: send
    },
    { from: 'national', to: 'issued', on: NATIONAL_ACCEPTED, actor: NATIONAL_ACTOR, guard: PAID, effects: given },
    { from: 'national', to: 'approval', on: NATIONAL_REJECTED, actor: NATIONAL_ACTOR, effects: [E.voidPendingLicence] },
    { from: 'national', to: 'approval', on: 'timeout' }
];

const lastStates = (reviewed: readonly string[]) => [
    // a fee never paid closes the case in the end, and its order with it
    { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
    {
        key: 'approval',
        kind: 'task',
        label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
        assignee: { role: 'competency.lead', unit: '${approval_unit}' },
        separationOfDuties: reviewed,
        sla: { businessDays: 2 }
    },
    {
        key: 'national',
        kind: 'wait',
        label: text('የብሔራዊ መድረክ ምላሽ በመጠበቅ ላይ', 'Waiting for the national platform'),
        sla: { businessDays: 2 }
    },
    { key: 'issued', kind: 'end', label: text('ተሰጥቷል', 'Issued') },
    { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
];

const REJECT = (from: readonly string[]) => ({
    from,
    to: 'rejected',
    action: 'reject',
    label: text('ውድቅ አድርግ', 'Reject'),
    rejectRoles: REJECT_ROLES,
    commentRequired: true,
    // a licence still waiting for the national platform goes with the case: it must not stand in the holder's way for good
    effects: [E.voidPendingLicence]
});

/** Whoever filed a request may take it back while it is theirs: a refused one must not stay open for ever. */
const WITHDRAW = {
    from: 'draft',
    to: 'rejected',
    action: 'withdraw',
    label: text('ጥያቄውን ሰርዝ', 'Withdraw the request'),
    commentRequired: true
};

const DRAFT = { key: 'draft', kind: 'start', label: text('ረቂቅ', 'Draft') };
const REVIEW_LABEL = text('ሰነድ ማጣራት', 'Document review');
const CARD_AND_PRINT = [E.issueLicenceCard, E.addToPrintBatch];

/** New licence (DVC-03): documents, exam, payment, approval, the national platform. Temporary for 2 years. */
export const newLicenceFlow = (examForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        task('exam', text('ፈተና', 'Examination'), 'competency.examiner', 10, { stepForm: examForm }),
        ...lastStates(['draft', 'review', 'exam'])
    ],
    transitions: [
        {
            from: 'draft',
            to: 'review',
            action: 'submit',
            effects: [E.checkApplication]
        },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', E.checkApplication]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        { from: 'review', to: 'exam', action: 'approve', label: ACTIONS.approve },
        {
            from: 'exam',
            to: 'payment',
            action: 'pass',
            label: ACTIONS.pass,
            effects: [`${E.recordExam}:passed`, 'fees.createPaymentOrder']
        },
        { from: 'exam', to: 'exam', action: 'fail', label: ACTIONS.fail, effects: [`${E.recordExam}:failed`] },
        ...finish([E.createPendingLicence], [E.activateLicence, ...CARD_AND_PRINT]),
        WITHDRAW,
        REJECT(['review', 'exam', 'approval'])
    ]
});

/**
 * Renewal (DVC-04): 4 years, 2 over 55. More than a year late adds a practical exam (Art. 19(5)). A temporary licence's holder has their
 * offence record checked first (Art. 15(3)): by an officer, until ITRMS can read the national penalty system.
 */
export const renewalFlow = (examForm: string) => {
    const LATE = { fact: 'renewal.lateOverYear', op: 'eq', value: true };
    const ON_TIME = { fact: 'renewal.lateOverYear', op: 'eq', value: false };
    const toPayment = ['fees.createPaymentOrder'];
    const onward = (from: string, action: string, label: I18nText) => [
        { from, to: 'field_exam', action, label, guard: LATE },
        { from, to: 'payment', action, label, guard: ON_TIME, effects: toPayment }
    ];
    return {
        schemaVersion: 1,
        states: [
            DRAFT,
            task('review', REVIEW_LABEL, 'competency.officer', 1),
            task('offence_check', text('የጥፋት መዝገብ ማጣራት', 'Offence record check'), 'competency.officer', 2),
            task('field_exam', text('የተግባር ፈተና', 'Practical exam'), 'competency.examiner', 10, { stepForm: examForm }),
            ...lastStates(['draft', 'review', 'offence_check', 'field_exam'])
        ],
        transitions: [
            { from: 'draft', to: 'review', action: 'submit', effects: [E.checkRenewal] },
            {
                from: 'draft',
                to: 'review',
                action: 'correct',
                label: ACTIONS.correct,
                amendsRequest: true,
                effects: ['fees.assess', E.checkRenewal]
            },
            { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
            {
                from: 'review',
                to: 'offence_check',
                action: 'approve',
                label: ACTIONS.approve,
                guard: { fact: 'renewal.temporary', op: 'eq', value: true }
            },
            ...onward('review', 'approve', ACTIONS.approve),
            ...onward('offence_check', 'clear', text('መዝገቡ ንጹህ ነው', 'The record is clear')),
            {
                from: 'field_exam',
                to: 'payment',
                action: 'pass',
                label: ACTIONS.pass,
                effects: [`${E.recordExam}:passed`, ...toPayment]
            },
            {
                from: 'field_exam',
                to: 'field_exam',
                action: 'fail',
                label: ACTIONS.fail,
                effects: [`${E.recordExam}:failed`]
            },
            ...finish([E.requestRenewal], [E.renewLicence, ...CARD_AND_PRINT]),
            WITHDRAW,
            REJECT(['review', 'offence_check', 'field_exam', 'approval'])
        ]
    };
};

/** The published form of this key, or this one published for the first time. A bureau's own version is never replaced. */
async function publishedForm(
    tx: Tx,
    root: { id: string; regionId: string },
    key: string,
    name: I18nText,
    document: object
): Promise<{ versionId: string; number: number }> {
    const [existing] = await tx
        .select()
        .from(formDefinitions)
        .where(and(eq(formDefinitions.regionId, root.regionId), eq(formDefinitions.key, key)));
    if (existing?.publishedVersionId) {
        const [live] = await tx
            .select({ number: formVersions.number })
            .from(formVersions)
            .where(eq(formVersions.id, existing.publishedVersionId));
        return { versionId: existing.publishedVersionId, number: live?.number ?? 1 };
    }
    const hash = contentHash(document);
    const form =
        existing ??
        (await insertAudited(tx, formDefinitions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            key,
            name,
            document,
            documentHash: hash
        }));
    const version = await insertAudited(tx, formVersions, {
        regionId: root.regionId,
        ownerUnitId: root.id,
        formId: form.id,
        number: 1,
        contentHash: hash,
        document
    });
    await updateAudited(tx, formDefinitions, form.id, form.rowVersion, {
        document,
        documentHash: hash,
        publishedVersionId: version.id,
        publishedAt: new Date()
    });
    return { versionId: version.id, number: version.number };
}

async function workflowVersion(
    tx: Tx,
    root: { id: string; regionId: string },
    key: string,
    name: I18nText,
    definition: unknown
): Promise<string> {
    const [existing] = await tx
        .select()
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.regionId, root.regionId), eq(workflowDefinitions.key, key)));
    if (existing?.latestVersionId) return existing.latestVersionId;
    const parsed = workflowDefinitionSchema.parse(definition);
    const flow =
        existing ??
        (await insertAudited(tx, workflowDefinitions, {
            regionId: root.regionId,
            ownerUnitId: root.id,
            key,
            name
        }));
    const version = await insertAudited(tx, workflowDefinitionVersions, {
        regionId: root.regionId,
        ownerUnitId: root.id,
        definitionId: flow.id,
        number: 1,
        contentHash: contentHash(parsed),
        definition: parsed
    });
    await updateAudited(tx, workflowDefinitions, flow.id, flow.rowVersion, { latestVersionId: version.id });
    return version.id;
}

/** The region's newest approved version of a fee rule: a version still waiting for its second person can't be charged by. */
async function approvedFeeRule(tx: Tx, regionId: string, key: string): Promise<string> {
    const [approved] = await tx
        .select({ id: feeRuleVersions.id })
        .from(feeRuleVersions)
        .innerJoin(feeRules, eq(feeRules.id, feeRuleVersions.ruleId))
        .innerJoin(feeRuleApprovals, eq(feeRuleApprovals.versionId, feeRuleVersions.id))
        .where(and(eq(feeRules.regionId, regionId), eq(feeRules.key, key), eq(feeRuleApprovals.decision, 'approved')))
        .orderBy(desc(feeRuleVersions.number))
        .limit(1);
    if (!approved) throw new Error(`fee rule ${key}: seed and approve the fee rules first`);
    return approved.id;
}

/** A service's first version. One that has any version already is the bureau's to change, and is left alone. */
async function firstServiceVersion(
    tx: Tx,
    root: { id: string; regionId: string },
    service: typeof serviceDefinitions.$inferSelect,
    parts: { formVersionId: string; workflowVersionId: string; feeRuleVersionId: string }
): Promise<void> {
    const content = {
        ...parts,
        defaults: { approval_unit: 'handling' },
        // a bureau, or an office below it, may say whose lead gives the final approval (docs/demo-plan.md, step 10)
        overridePolicy: { approval_unit: ['region', 'unit'], sla: ['region', 'unit'] },
        inputMap: {},
        effectiveFrom: addisDay()
    };
    const version = await insertAudited(tx, serviceVersions, {
        regionId: root.regionId,
        serviceId: service.id,
        number: 1,
        contentHash: contentHash(content),
        ...content
    });
    await updateAudited(tx, serviceDefinitions, service.id, service.rowVersion, { currentVersionId: version.id });
}

/** Both services at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importLicenceServices(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const exam = await publishedForm(tx, root, 'licence-exam-result', text('የፈተና ውጤት', 'Exam result'), EXAM_FORM);
    const examRef = `licence-exam-result@${exam.number}`;
    const services = [
        {
            code: 'DVC-03',
            key: 'new-driver-licence',
            name: text('አዲስ መንጃ ፈቃድ', 'New driver licence'),
            form: NEW_LICENCE_FORM,
            flow: newLicenceFlow(examRef),
            feeRule: 'dvc-03-new-licence'
        },
        {
            code: 'DVC-04',
            key: 'driver-licence-renewal',
            name: text('የመንጃ ፈቃድ እድሳት', 'Driver licence renewal'),
            form: RENEWAL_FORM,
            flow: renewalFlow(examRef),
            feeRule: 'dvc-04-renewal'
        }
    ];
    let changed = 0;
    for (const s of services) {
        const [service] = await tx
            .select()
            .from(serviceDefinitions)
            .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, s.code)))
            .for('update');
        if (!service) throw new Error(`service ${s.code}: seed the catalogue first`);
        if (service.currentVersionId) continue;
        const form = await publishedForm(tx, root, s.key, s.name, s.form);
        await firstServiceVersion(tx, root, service, {
            formVersionId: form.versionId,
            workflowVersionId: await workflowVersion(tx, root, s.key, s.name, s.flow),
            feeRuleVersionId: await approvedFeeRule(tx, root.regionId, s.feeRule)
        });
        changed += 1;
    }
    return changed;
}
