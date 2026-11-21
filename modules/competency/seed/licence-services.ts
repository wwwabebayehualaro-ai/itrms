/**
 * The two licence services as configuration (task 0.24b; the renewal's version 2 with its medical steps, task 1.6a): their forms, workflows and fee rules, and nothing else. No code here decides
 * anything; a bureau can change any of it the way it changes any service. It is an installation step, as the fee rules are: the bureau
 * reviews what it inherits, and a second person's approval is for what it changes. It only ever makes a service's first version: run
 * again, it leaves what a bureau has published alone.
 */
import { and, eq, sql } from 'drizzle-orm';
import { setUpCounter } from '@itrms/kernel/numbering';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import type { Tx } from '@itrms/kernel/db';

import {
    COMPETENCY_EFFECTS as E,
    DRIVING_PERMIT_COUNTER,
    DRIVING_PERMIT_EFFECTS,
    DRIVING_PERMIT_PATTERN,
    MAX_MEDICAL_INSTITUTIONS,
    MEDICAL_EFFECTS as M,
    MEDICAL_FACILITY_MAX,
    MEDICAL_RECOMMENDATIONS,
    MEDICAL_REFERRAL_COUNTER,
    MEDICAL_REFERRAL_PATTERN,
    MEDICAL_REPORT_NUMBER_MAX,
    NATIONAL_ACCEPTED,
    NATIONAL_ACTOR,
    NATIONAL_REJECTED
} from '../contracts';
import { LICENCE_GRADES } from './grades';
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

/**
 * DVC-04 version 2 (task 1.6a): the medical examination is no longer typed with the request. It is a step of its own: the referral
 * letter the office writes, or the report the holder brings, recorded when it comes back.
 */
export const RENEWAL_FORM_V2 = {
    schemaVersion: 2,
    fields: [
        field('licence', 'RegistryLookup', text('መንጃ ፈቃድ', 'Driver licence'), { provider: 'driver-licence' }),
        // these two work the fee out when the request is filed; on submit they must agree with the register
        GRADE,
        field('expiry', 'EthDate', text('ፈቃዱ የሚያበቃበት ቀን', 'The licence’s expiry date')),
        field('lost', 'Checkbox', text('ካርዱ ጠፍቷል', 'The card was lost'), { required: false }),
        FEE
    ]
};

/** The referral step: the health facility the holder is sent to. */
export const MEDICAL_REFERRAL_FORM = {
    schemaVersion: 2,
    fields: [
        field('institution', 'InputText', text('ሪፈር የሚደረግበት የጤና ተቋም', 'Health facility referred to'), {
            minLength: 2,
            maxLength: MEDICAL_FACILITY_MAX
        })
    ]
};

const RECOMMENDATION_LABELS = {
    grant: text('ይሰጠው', 'Grant'),
    grant_with_conditions: text('በገደብ ወይም በቅድመ ሁኔታ ይሰጠው', 'Grant with restrictions or conditions'),
    refuse: text('አይሰጠው', 'Refuse')
};

/**
 * The report step: what the health bureau's "Drivers physical examination report" says of itself and its recommendation. Its
 * findings stay on the paper (ADR-0052); conditions it grants with are recorded by a command, never here (ADR-0064 §4).
 */
export const MEDICAL_REPORT_FORM = {
    schemaVersion: 2,
    fields: [
        field('facility', 'InputText', text('የመረመረው የጤና ተቋም', 'Examining health facility'), {
            minLength: 2,
            maxLength: MEDICAL_FACILITY_MAX
        }),
        field('examinedOn', 'EthDate', text('የምርመራ ቀን', 'Date of the examination')),
        field('reportNumber', 'InputText', text('የሪፖርቱ ቁጥር', 'Report number'), {
            required: false,
            maxLength: MEDICAL_REPORT_NUMBER_MAX
        }),
        field(
            'recommendation',
            'Dropdown',
            text('የሐኪሙ ውሳኔ', 'Recommendation'),
            {},
            {
                // a health outcome: masked to those who read the case, kept to the effect that records it (SEC-PD-2)
                classification: 'sensitive',
                data: {
                    dataSource: {
                        staticData: MEDICAL_RECOMMENDATIONS.map((value) => ({
                            value,
                            label: RECOMMENDATION_LABELS[value]
                        }))
                    }
                }
            }
        ),
        attachment('reportScan', text('የምርመራ ሪፖርቱ ቅጂ', 'Copy of the report'), 'sensitive')
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

/**
 * Renewal (DVC-04) version 2 (task 1.6a): as version 1, with the medical examination as steps. The reviewing officer refers the
 * holder to a health facility (a letter with a QR, from the office's counter), or takes the report the holder brings. A granting
 * report goes on as version 1 did; a refusing one is referred again to another institution, up to the third (Art. 13), or the case is
 * rejected. Conditions a report grants with are recorded before the final approval, never in a form.
 */
export const renewalFlowV2 = (examForm: string, referralForm: string, reportForm: string) => {
    const LATE = { fact: 'renewal.lateOverYear', op: 'eq', value: true };
    const ON_TIME = { fact: 'renewal.lateOverYear', op: 'eq', value: false };
    const TEMPORARY = { fact: 'renewal.temporary', op: 'eq', value: true };
    const toPayment = ['fees.createPaymentOrder'];
    const FIT = `${M.recordMedicalReport}:fit`;
    const FIT_LABEL = text('ለማሽከርከር ብቁ ነው', 'Fit to drive');
    const REFER = text('ወደ ጤና ተቋም ሪፈር አድርግ', 'Refer to a health facility');
    const CLEAR = text('መዝገቡ ንጹህ ነው', 'The record is clear');
    return {
        schemaVersion: 1,
        states: [
            DRAFT,
            task('review', REVIEW_LABEL, 'competency.officer', 1),
            task('referral', text('የህክምና ሪፈራል', 'Medical referral'), 'competency.officer', 1, {
                stepForm: referralForm
            }),
            task('medical', text('የህክምና ምርመራ ሪፖርት', 'Medical examination report'), 'competency.officer', 30, {
                stepForm: reportForm
            }),
            task('medical_refused', text('ሪፖርቱ አይሰጠው ብሏል', 'The report refuses'), 'competency.officer', 2),
            task('offence_check', text('የጥፋት መዝገብ ማጣራት', 'Offence record check'), 'competency.officer', 2),
            task('field_exam', text('የተግባር ፈተና', 'Practical exam'), 'competency.examiner', 10, { stepForm: examForm }),
            ...lastStates(['draft', 'review', 'referral', 'medical', 'medical_refused', 'offence_check', 'field_exam'])
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
            // the holder brought the health bureau's report
            {
                from: 'review',
                to: 'medical',
                action: 'approve',
                label: text('ሪፖርቱ ቀርቧል', 'The holder brings a report')
            },
            { from: 'review', to: 'referral', action: 'refer', label: REFER },
            // a refused report goes to a second and a third institution, no further (Art. 13)
            {
                from: 'medical_refused',
                to: 'referral',
                action: 'refer',
                label: REFER,
                guard: { fact: 'medical.reports', op: 'lt', value: MAX_MEDICAL_INSTITUTIONS }
            },
            {
                from: 'referral',
                to: 'medical',
                action: 'issue_referral',
                label: text('የሪፈራል ደብዳቤውን ስጥ', 'Issue the referral letter'),
                effects: [M.issueMedicalReferral]
            },
            { from: 'medical', to: 'offence_check', action: 'fit', label: FIT_LABEL, guard: TEMPORARY, effects: [FIT] },
            { from: 'medical', to: 'field_exam', action: 'fit', label: FIT_LABEL, guard: LATE, effects: [FIT] },
            {
                from: 'medical',
                to: 'payment',
                action: 'fit',
                label: FIT_LABEL,
                guard: ON_TIME,
                effects: [FIT, ...toPayment]
            },
            {
                from: 'medical',
                to: 'medical_refused',
                action: 'unfit',
                label: text('ብቁ አይደለም', 'Not fit to drive'),
                effects: [`${M.recordMedicalReport}:unfit`]
            },
            { from: 'offence_check', to: 'field_exam', action: 'clear', label: CLEAR, guard: LATE },
            { from: 'offence_check', to: 'payment', action: 'clear', label: CLEAR, guard: ON_TIME, effects: toPayment },
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
            // the temporary driving permit while the region prints (task 1.6d, ADR-0064 §7)
            ...finish(
                [E.requestRenewal],
                [E.renewLicence, ...CARD_AND_PRINT, DRIVING_PERMIT_EFFECTS.issueDrivingPermit]
            ),
            WITHDRAW,
            REJECT(['review', 'referral', 'medical', 'medical_refused', 'offence_check', 'field_exam', 'approval'])
        ]
    };
};

/**
 * The temporary driving permits' counter at every office that offers DVC-04 (task 1.6d) or DVC-19 (task 1.6e). Returns how many offices
 * have it.
 */
export async function setUpDrivingPermitCounters(
    tx: Tx,
    regionId: string,
    pattern = DRIVING_PERMIT_PATTERN
): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select distinct u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code in ('DVC-04', 'DVC-19')`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: DRIVING_PERMIT_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

/** The referral letters' counter at every office that offers DVC-04. Returns how many offices have it. */
export async function setUpMedicalReferralCounters(
    tx: Tx,
    regionId: string,
    pattern = MEDICAL_REFERRAL_PATTERN
): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = 'DVC-04'`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: MEDICAL_REFERRAL_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

/** Both services at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importLicenceServices(
    tx: Tx,
    root: { id: string; regionId: string },
    options: {
        /**
         * Only for the test that shows cases on version 1 finish: DVC-04 is made at version 1 and left there. Seeded again without it,
         * the seed's own version 1 moves to version 2 (a bureau's own version is never touched).
         */
        renewalV1?: boolean;
    } = {}
): Promise<number> {
    const exam = await publishedForm(tx, root, 'licence-exam-result', text('የፈተና ውጤት', 'Exam result'), EXAM_FORM);
    const examRef = `licence-exam-result@${exam.number}`;
    const referral = await publishedForm(
        tx,
        root,
        'licence-medical-referral',
        text('የህክምና ሪፈራል', 'Medical referral'),
        MEDICAL_REFERRAL_FORM
    );
    const report = await publishedForm(
        tx,
        root,
        'licence-medical-report',
        text('የህክምና ምርመራ ሪፖርት', 'Medical examination report'),
        MEDICAL_REPORT_FORM
    );
    const renewalV1 = options.renewalV1 === true;
    const renewalV2 = renewalFlowV2(
        examRef,
        `licence-medical-referral@${referral.number}`,
        `licence-medical-report@${report.number}`
    );
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
            form: renewalV1 ? RENEWAL_FORM : RENEWAL_FORM_V2,
            flow: renewalV1 ? renewalFlow(examRef) : renewalV2,
            feeRule: 'dvc-04-renewal',
            // seeded before task 1.6a: the seed's version 1 moves to version 2, its cases finishing on the version they froze
            next: renewalV1 ? undefined : { flow: renewalV2, form: RENEWAL_FORM_V2 }
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
        if (service.currentVersionId) {
            const next = 'next' in s ? s.next : undefined;
            if (
                next &&
                // only with its form: version 2's flow never runs on version 1's request (task 1.6a)
                (await supersedeSeededVersion(
                    tx,
                    root,
                    service,
                    s.key,
                    next.flow,
                    { key: s.key, document: next.form },
                    { withForm: true }
                ))
            )
                changed += 1;
            continue;
        }
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
