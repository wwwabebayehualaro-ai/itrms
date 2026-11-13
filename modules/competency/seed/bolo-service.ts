/**
 * The annual technical inspection and its bolo (DVC-02, task 1.3a) as configuration: the request, the inspection step on the
 * bureau's light-vehicle checklist (a `Checklist`, task 1.13a), the sticker step, its workflow and the fee rule it names. The
 * checklist's items are generated from the groups the zone's serial-numbered sheet covers (the papers, lights and emissions,
 * brakes, the body, the safety equipment), not copied from it: a bureau's own sheet replaces them, item by item, in the builder.
 * Like the other services it only ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { setUpCounter } from '@itrms/kernel/numbering';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import { VEHICLE_USES } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import { BOLO_EFFECTS as B, BOLO_SERVICE, TEMPORARY_BOLO_COUNTER, TEMPORARY_BOLO_PATTERN } from '../contracts';
import {
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
    workflowVersion,
    ACTIONS
} from './service-config';

const words = (key: string): I18nText => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/**
 * The request at the counter: the vehicle from the register; its use, seats and load as the fee is worked out from them (the
 * check compares the use with the register); the third-party insurance certificate; and the papers the zone asks before a bolo,
 * kept as attachments (the Road Fund receipt is required by the check for a vehicle of plate code 1 or 3).
 */
export const BOLO_REQUEST_FORM = {
    schemaVersion: 2,
    fields: [
        field(
            'vehicle',
            'RegistryLookup',
            text('ተሽከርካሪ', 'Vehicle'),
            { provider: 'vehicle' },
            { classification: 'internal' }
        ),
        field(
            'use',
            'Dropdown',
            text('አገልግሎት', 'Use'),
            {},
            {
                classification: 'internal',
                data: {
                    dataSource: {
                        staticData: VEHICLE_USES.map((u) => ({ label: words(`vehicles.use.${u}`), value: u }))
                    }
                }
            }
        ),
        field(
            'seats',
            'InputNumber',
            text('የወንበር ብዛት', 'Seats'),
            { required: false, min: 1, max: 120 },
            { classification: 'internal' }
        ),
        field(
            'loadTonnes',
            'InputNumber',
            text('የመጫን አቅም (ቶን)', 'Load capacity (t)'),
            { required: false, min: 0, max: 200 },
            { classification: 'internal' }
        ),
        field(
            'insuranceCertificate',
            'InputText',
            text('የመድን ሰርተፊኬት ቁጥር', 'Insurance certificate number'),
            { maxLength: 40 },
            { classification: 'internal' }
        ),
        field('insurer', 'InputText', text('መድን ሰጪ', 'Insurer'), { maxLength: 200 }, { classification: 'internal' }),
        field('insuredFrom', 'EthDate', text('ፖሊሲው የሚጀምርበት', 'Policy from'), {}, { classification: 'internal' }),
        field('insuredUntil', 'EthDate', text('ፖሊሲው የሚያበቃበት', 'Policy until'), {}, { classification: 'internal' }),
        attachment('insuranceCopy', text('የመድን ሰርተፊኬት ቅጂ', 'Copy of the insurance certificate'), 'internal'),
        attachment('roadFundReceipt', text('የመንገድ ፈንድ ክፍያ ደረሰኝ', 'Road Fund payment receipt'), 'internal'),
        attachment('licenceCopy', text('የአሽከርካሪ መንጃ ፈቃድ ቅጂ', "Copy of the driver's licence")),
        attachment('inspectionReceipt', text('የምርመራ ክፍያ ደረሰኝ', 'Inspection receipt'), 'internal'),
        FEE
    ]
};

const item = (key: string, am: string, en: string, critical = false) => ({
    key,
    text: text(am, en),
    ...(critical ? { critical } : {})
});

/** The light-vehicle sheet's groups (the zone's sheet has about 40 items, each correct or not). */
export const LIGHT_VEHICLE_CHECKLIST = [
    {
        key: 'papers',
        title: text('ሰነዶችና መለያዎች', 'Papers and identification'),
        items: [
            item('libre', 'የባለቤትነት ሊብሬ ከተሽከርካሪው ጋር ይስማማል', 'The libre matches the vehicle', true),
            item('chassis', 'የሻሲ ቁጥሩ ከሊብሬው ጋር ይስማማል', 'The chassis number matches the libre', true),
            item('engine', 'የሞተር ቁጥሩ ከሊብሬው ጋር ይስማማል', 'The engine number matches the libre', true),
            item('plates', 'የፊትና የኋላ ሰሌዳ ተገጥሟል፣ ይነበባል', 'Front and rear plates fitted and legible')
        ]
    },
    {
        key: 'lights',
        title: text('መብራቶችና ጭስ', 'Lights and emissions'),
        items: [
            item('headlights', 'የፊት መብራቶች (ረጅምና አጭር)', 'Headlights (high and low beam)'),
            item('indicators', 'የመታጠፊያ ምልክቶች', 'Indicators'),
            item('brakeLights', 'የፍሬን መብራቶች', 'Brake lights'),
            item('tailLights', 'የኋላ መብራቶች', 'Tail lights'),
            item('horn', 'ጡሩምባ', 'Horn'),
            item('emissions', 'የጭስ ልቀት (CO/HC) በገደቡ ውስጥ', 'Emissions (CO/HC) within the limit')
        ]
    },
    {
        key: 'brakes',
        title: text('ፍሬን', 'Brakes'),
        items: [
            item('serviceBrake', 'የእግር ፍሬን', 'Service brake', true),
            item('parkingBrake', 'የእጅ ፍሬን', 'Parking brake', true),
            item('brakeFluid', 'የፍሬን ዘይት አይፈስም', 'No brake fluid leak')
        ]
    },
    {
        key: 'body',
        title: text('አካል፣ ተሸካሚና ጎማ', 'Body, suspension and tyres'),
        items: [
            item('steering', 'መሪ', 'Steering', true),
            item('suspension', 'ተሸካሚ (ሱስፔንሽን)', 'Suspension'),
            item('tyres', 'ጎማዎች (ጥልቀትና ሁኔታ)', 'Tyres (tread and condition)'),
            item('windscreen', 'የፊት መስታወትና መጥረጊያ', 'Windscreen and wipers'),
            item('mirrors', 'መስታወቶች (የጎንና የውስጥ)', 'Mirrors (side and inside)'),
            item('bodywork', 'አካሉ (ዝገትና ስብራት)', 'Bodywork (rust and damage)')
        ]
    },
    {
        key: 'safety',
        title: text('የደኅንነት መሣሪያዎች', 'Safety equipment'),
        items: [
            item('seatBelts', 'የደኅንነት ቀበቶዎች', 'Seat belts'),
            item('extinguisher', 'የእሳት ማጥፊያ', 'Fire extinguisher'),
            item('triangle', 'የአደጋ ምልክት (ሦስት ማዕዘን)', 'Warning triangle'),
            item('hazardLabel', 'የአደገኛ ጭነት ምልክት (ሲያስፈልግ)', 'Hazard label (where needed)')
        ]
    }
];

/** The inspector's step: the sheet's serial and the day, the checklist, a photo of the plate and the inspector's signature. */
export const BOLO_INSPECTION_FORM = {
    schemaVersion: 2,
    fields: [
        field(
            'checklistSerial',
            'InputText',
            text('የምርመራ ቅጽ ቁጥር', 'Checklist sheet number'),
            { maxLength: 40 },
            { classification: 'internal' }
        ),
        field(
            'inspectedOn',
            'EthDate',
            text('የተመረመረበት ቀን (ባዶ ከሆነ ዛሬ)', 'Inspected on (today if left empty)'),
            { required: false },
            { classification: 'internal' }
        ),
        field(
            'inspection',
            'Checklist',
            text('የቀላል ተሽከርካሪ ዓመታዊ ምርመራ', 'Light vehicle annual inspection'),
            { scoring: 'passFail', allowNotApplicable: true, remarkOnFail: true, sections: LIGHT_VEHICLE_CHECKLIST },
            { classification: 'internal' }
        ),
        field(
            'platePhoto',
            'Photo',
            text('የሰሌዳው ፎቶ', 'Photo of the plate'),
            { required: false, crop: 'none', facing: 'environment' },
            { classification: 'internal' }
        ),
        field(
            'inspectorSignature',
            'Signature',
            text('የመርማሪው ፊርማ', "Inspector's signature"),
            { required: false },
            { classification: 'internal' }
        )
    ]
};

/** The sticker step: the serial of the sticker handed over, if not the office's next one. */
export const BOLO_STICKER_FORM = {
    schemaVersion: 2,
    fields: [
        field(
            'stickerSerial',
            'InputText',
            text('የቦሎ ምልክት ቁጥር (ከሚቀጥለው የተለየ ከሆነ)', 'Bolo sticker number (if not the next one)'),
            { required: false, maxLength: 40 },
            { classification: 'internal' }
        )
    ]
};

const STICKER_STEP = { stepFormKey: 'vehicle-bolo-sticker' } as const;

/**
 * DVC-02: documents and prerequisites, payment, the inspection (pass makes the bolo, and is refused unless the checklist passed;
 * fail closes the case with the failed items: a re-inspection after the garage comes in task 1.3b), then the sticker, or a
 * temporary bolo first while the office has no sticker of the vehicle's kind and year.
 */
export const boloFlow = (inspectionForm: string, stickerForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        task('inspection', text('የቴክኒክ ምርመራ', 'Technical inspection'), 'competency.officer', 2, {
            stepForm: inspectionForm
        }),
        task('sticker', text('የቦሎ ምልክት', 'Bolo sticker'), 'competency.officer', 1, { stepForm: stickerForm }),
        task(
            'temporary',
            text('ጊዜያዊ ቦሎ ተሰጥቷል፣ ምልክቱን በመጠበቅ ላይ', 'Temporary bolo given, waiting for the sticker'),
            'competency.officer',
            30,
            {
                stepForm: stickerForm
            }
        ),
        { key: 'issued', kind: 'end', label: text('ቦሎ ተሰጥቷል', 'Bolo issued') },
        { key: 'failed', kind: 'end', label: text('ምርመራውን አላለፈም', 'Failed the inspection') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [B.checkBolo] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', B.checkBolo]
        },
        { from: 'review', to: 'draft', action: 'return', label: ACTIONS.returnIt, commentRequired: true },
        {
            from: 'review',
            to: 'payment',
            action: 'approve',
            label: ACTIONS.approve,
            effects: ['fees.createPaymentOrder']
        },
        { from: 'payment', to: 'inspection', on: 'event:payment.settled', actor: 'system:fees', guard: PAID },
        { from: 'payment', to: 'rejected', on: 'timeout' },
        {
            from: 'inspection',
            to: 'sticker',
            action: 'pass',
            label: text('አልፏል', 'Passed'),
            guard: PAID,
            effects: [`${B.recordBoloInspection}:pass`]
        },
        {
            from: 'inspection',
            to: 'failed',
            action: 'fail',
            label: text('አላለፈም', 'Failed'),
            effects: [`${B.recordBoloInspection}:fail`]
        },
        {
            from: ['sticker', 'temporary'],
            to: 'issued',
            action: 'issue_sticker',
            label: text('ምልክቱን ስጥ', 'Issue the sticker'),
            guard: PAID,
            effects: [B.issueBoloSticker]
        },
        {
            from: 'sticker',
            to: 'temporary',
            action: 'issue_temporary',
            label: text('ጊዜያዊ ቦሎ ስጥ', 'Issue a temporary bolo'),
            guard: PAID,
            effects: [B.issueTemporaryBolo]
        },
        WITHDRAW,
        {
            // after the pass too: a vehicle whose sticker no office can give is not stuck, and its bolo is void
            from: ['review', 'inspection', 'sticker', 'temporary'],
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true,
            effects: [B.voidBolo]
        }
    ]
});

/** The temporary bolo's counter at every office that offers DVC-02. Returns how many offices have it. */
export async function setUpBoloCounters(tx: Tx, regionId: string, pattern = TEMPORARY_BOLO_PATTERN): Promise<number> {
    const offices = await tx.execute<{ id: string }>(sql`
        select u.id from kernel.org_units u
          join kernel.unit_type_services s on s.unit_type_id = u.unit_type_id
         where u.region_id = ${regionId} and u.active and s.service_code = ${BOLO_SERVICE}`);
    for (const office of offices.rows)
        await setUpCounter(tx, { key: TEMPORARY_BOLO_COUNTER, unitId: office.id, regionId, pattern });
    return offices.rows.length;
}

/** DVC-02 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importBoloService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, BOLO_SERVICE)))
        .for('update');
    if (!service) throw new Error(`service ${BOLO_SERVICE}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የተሽከርካሪ ቴክኒክ ምርመራና ቦሎ', 'Technical inspection and bolo');
    const inspection = await publishedForm(
        tx,
        root,
        'vehicle-bolo-inspection',
        text('የተሽከርካሪ ዓመታዊ ምርመራ', 'Vehicle annual inspection'),
        BOLO_INSPECTION_FORM
    );
    const sticker = await publishedForm(
        tx,
        root,
        STICKER_STEP.stepFormKey,
        text('የቦሎ ምልክት', 'Bolo sticker'),
        BOLO_STICKER_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-bolo', name, BOLO_REQUEST_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-bolo',
            name,
            boloFlow(`vehicle-bolo-inspection@${inspection.number}`, `${STICKER_STEP.stepFormKey}@${sticker.number}`)
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-02-bolo')
    });
    return 1;
}
