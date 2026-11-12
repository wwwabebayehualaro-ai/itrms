/**
 * The new vehicle registration service (DVC-01, task 1.2b) as configuration: its two forms, its workflow and the fee rule it
 * names, and nothing else. No code here decides anything; a bureau can change any of it the way it changes any service. Like the
 * licence services it only ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import { FUELS, VEHICLE_USES } from '@itrms/vehicles/contracts';
import { VEHICLE_CATEGORIES } from '@itrms/vehicles/seed';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import { NEW_REGISTRATION_SERVICE, REGISTRATION_CERTIFICATE_TEMPLATE, REGISTRATION_EFFECTS as E } from '../contracts';
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

/** The words the vehicles slice already has for a vehicle's use and fuel, as the dropdowns' labels. */
const words = (key: string): I18nText => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

const dropdown = (
    id: string,
    label: I18nText,
    options: readonly { label: I18nText; value: string }[],
    required: boolean
) =>
    field(
        id,
        'Dropdown',
        label,
        { required },
        { classification: 'internal', data: { dataSource: { staticData: options.map((o) => ({ ...o })) } } }
    );

/** A fact of the vehicle, as its papers state it: internal, not personal. */
const fact = (id: string, type: string, label: I18nText, props: Record<string, unknown> = {}) =>
    field(id, type, label, props, { classification: 'internal' });

/**
 * The request, filed by staff at the counter. Its field ids are the register's own names for them (`vehicleRegisterSchema`), so a
 * refusal of the register points at the field it is about. The papers are kept as attachments, not required, as the licence forms'.
 */
export const VEHICLE_REGISTRATION_FORM = {
    schemaVersion: 2,
    fields: [
        field(
            'owners',
            'FormArray',
            text('ባለቤቶች', 'Owners'),
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
        fact('chassisNumber', 'InputText', text('የሻሲ ቁጥር', 'Chassis number'), { maxLength: 40 }),
        dropdown(
            'chassisKind',
            text('የሻሲ ቁጥር ዓይነት', 'Kind of chassis number'),
            [
                { label: text('ISO 3779 (VIN)', 'ISO 3779 (VIN)'), value: 'iso3779' },
                { label: text('ሌላ', 'Other'), value: 'other' }
            ],
            false
        ),
        fact(
            'chassisMismatchConfirmed',
            'Checkbox',
            text('የሻሲ ሰሌዳውን አይቻለሁ፤ የማረጋገጫ ቁጥሩ አይመሳሰልም', 'I checked the chassis plate: its check digit does not match'),
            { required: false }
        ),
        fact('engineNumber', 'InputText', text('የሞተር ቁጥር', 'Engine number'), { required: false, maxLength: 30 }),
        fact('make', 'InputText', text('ሰሪ', 'Make'), { maxLength: 60 }),
        fact('model', 'InputText', text('ሞዴል', 'Model'), { maxLength: 60 }),
        fact('modelYear', 'InputNumber', text('የተመረተበት ዓመት', 'Model year'), { min: 1900, max: 2100 }),
        dropdown(
            'categoryKey',
            text('የተሽከርካሪ ምድብ', 'Vehicle category'),
            VEHICLE_CATEGORIES.map((c) => ({ label: c.name, value: c.key })),
            true
        ),
        dropdown(
            'use',
            text('አገልግሎት', 'Use'),
            VEHICLE_USES.map((u) => ({ label: words(`vehicles.use.${u}`), value: u })),
            true
        ),
        fact('seats', 'InputNumber', text('የመቀመጫ ብዛት', 'Seats'), { required: false, min: 1, max: 200 }),
        fact('loadCapacityKg', 'InputNumber', text('የመጫን አቅም (ኪ.ግ)', 'Load capacity (kg)'), {
            required: false,
            min: 1,
            max: 200000
        }),
        fact('grossWeightKg', 'InputNumber', text('ጠቅላላ ክብደት (ኪ.ግ)', 'Gross weight (kg)'), {
            required: false,
            min: 1,
            max: 200000
        }),
        fact('engineCc', 'InputNumber', text('የሞተር መጠን (ሲሲ)', 'Engine size (cc)'), {
            required: false,
            min: 1,
            max: 100000
        }),
        fact('axles', 'InputNumber', text('የአክሰል ብዛት', 'Axles'), { required: false, min: 1, max: 12 }),
        fact('colour', 'InputText', text('ቀለም', 'Colour'), { required: false, maxLength: 30 }),
        dropdown(
            'fuel',
            text('ነዳጅ', 'Fuel'),
            FUELS.map((f) => ({ label: words(`vehicles.fuel.${f}`), value: f })),
            false
        ),
        // the temporary libre's other facts (ADR-0050; the zone's form): optional, the register keeps what is given
        fact('madeIn', 'InputText', text('የተሠራበት አገር', 'Made in'), { required: false, maxLength: 60 }),
        fact('engineHp', 'InputNumber', text('የሞተር ኃይል (HP)', 'Engine power (HP)'), { required: false }),
        fact('cylinders', 'InputNumber', text('የሲሊንደር ብዛት', 'Cylinders'), { required: false }),
        fact('lengthM', 'InputNumber', text('ርዝመት (ሜትር)', 'Length (m)'), { required: false }),
        fact('widthM', 'InputNumber', text('ስፋት (ሜትር)', 'Width (m)'), { required: false }),
        fact('heightM', 'InputNumber', text('ቁመት (ሜትር)', 'Height (m)'), { required: false }),
        fact('tyreSize', 'InputText', text('የጎማ መጠን', 'Tyre size'), { required: false, maxLength: 20 }),
        fact('tyres', 'InputNumber', text('የጎማ ብዛት', 'Tyres'), { required: false }),
        fact('netWeightKg', 'InputNumber', text('የተጣራ ክብደት (ኪ.ግ)', 'Net weight (kg)'), { required: false }),
        attachment('customsDeclaration', text('የጉምሩክ መግለጫ', 'Customs declaration'), 'internal'),
        // an imported vehicle's papers (the zone's answers, 2026-11-11)
        attachment('billOfLading', text('የጭነት ማስረከቢያ ሰነድ (Bill of Lading)', 'Bill of Lading'), 'internal'),
        attachment('commercialInvoice', text('የንግድ ደረሰኝ (Commercial invoice)', 'Commercial invoice'), 'internal'),
        attachment('packingList', text('የዕቃ ዝርዝር (Packing list)', 'Packing list'), 'internal'),
        attachment('proofOfPurchase', text('የግዢ ማስረጃ', 'Proof of purchase'), 'internal'),
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', 'Owner identity document')),
        // a business owner: its trade licence and TIN (an organisation's TIN is on its own record already)
        attachment('tradeLicence', text('የንግድ ፈቃድ (ለንግድ ባለቤት)', 'Trade licence (a business owner)'), 'internal'),
        field(
            'businessTin',
            'InputText',
            text('የግብር ከፋይ መለያ ቁጥር (TIN, ለንግድ ባለቤት)', 'TIN (a business owner)'),
            { required: false, maxLength: 10 },
            {
                classification: 'internal',
                behavior: {
                    validation: {
                        supported: true,
                        rules: {
                            pattern: '^[0-9]{10}$',
                            patternMessage: text('10 አሃዝ ያለው ቁጥር', 'A number of 10 digits')
                        }
                    }
                }
            }
        ),
        attachment('insuranceCertificate', text('የመድን ሰርተፍኬት', 'Insurance certificate'), 'internal'),
        FEE
    ]
};

/** The last step's answers: what the national system says, and the plate if it is not the one held for the case. */
export const NATIONAL_ENTRY_FORM = {
    schemaVersion: 2,
    fields: [
        fact('federalVehicleId', 'InputText', text('የፌዴራል ተሽከርካሪ መለያ', 'Federal vehicle id'), { maxLength: 40 }),
        fact(
            'replacementPlate',
            'InputText',
            text('የተሰጠው ሰሌዳ (ከተያዘው የተለየ ከሆነ)', 'Plate handed over (if not the reserved one)'),
            { required: false, maxLength: 40 }
        )
    ]
};

/**
 * The booklet step's answers (ADR-0050): the booklet the libre is written in when it is not the office's next one, the national
 * reference when given, and the booklets spoiled on the way, each with its reason.
 */
export const LIBRE_BOOKLET_FORM = {
    schemaVersion: 2,
    fields: [
        fact(
            'bookletSerial',
            'InputText',
            text('የሊብሬ ደብተር ቁጥር (የሚቀጥለው ካልሆነ)', 'Libre booklet serial (if not the next one)'),
            { required: false, maxLength: 40 }
        ),
        fact('libreNationalReference', 'InputText', text('ብሔራዊ መለያ', 'National reference'), {
            required: false,
            maxLength: 60
        }),
        field(
            'spoiledBooklets',
            'FormArray',
            text('የተበላሹ ደብተሮች', 'Spoiled booklets'),
            {
                required: false,
                minItems: 0,
                maxItems: 20,
                itemLabel: text('ደብተር', 'Booklet'),
                addButtonLabel: text('የተበላሸ ደብተር ጨምር', 'Add a spoiled booklet')
            },
            { category: 'Layout', classification: 'internal', layout: { options: { isContainer: true } } }
        ),
        field(
            'spoiledSerial',
            'InputText',
            text('የደብተሩ ቁጥር', 'Booklet serial'),
            { maxLength: 40 },
            { classification: 'internal', parentId: 'spoiledBooklets' }
        ),
        field(
            'spoiledReason',
            'InputText',
            text('ምክንያት', 'Reason'),
            { maxLength: 500 },
            { classification: 'internal', parentId: 'spoiledBooklets' }
        )
    ]
};

/**
 * DVC-01: documents, payment, approval, then the officer registers the vehicle with its federal id. The plate is held from the
 * approval, so that a registration approved can always be completed; a rejection gives it back. Registering issues the libre and
 * its temporary certificate; the last step writes the libre in a federal booklet from the office's stationery (ADR-0050). With no
 * booklet in stock the case waits there, the vehicle registered meanwhile, and the booklet is issued on it when they come.
 */
export const vehicleRegistrationFlow = (entryForm: string, bookletForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        // a fee never paid closes the case in the end, and its order with it
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        {
            key: 'approval',
            kind: 'task',
            label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['draft', 'review'],
            sla: { businessDays: 2 }
        },
        task('registration', text('ምዝገባና ሰሌዳ መስጠት', 'Registration and plate'), 'competency.officer', 2, {
            stepForm: entryForm,
            separationOfDuties: ['approval']
        }),
        task('booklet', text('የሊብሬ ደብተር መስጠት', 'Libre booklet'), 'competency.officer', 30, {
            stepForm: bookletForm
        }),
        { key: 'registered', kind: 'end', label: text('ተመዝግቧል', 'Registered') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [E.checkVehicleRegistration] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', E.checkVehicleRegistration]
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
            to: 'registration',
            action: 'approve',
            label: ACTIONS.approve,
            guard: PAID,
            effects: [E.reserveRegistrationPlate]
        },
        {
            from: 'registration',
            to: 'booklet',
            action: 'register',
            label: text('መዝግብ', 'Register the vehicle'),
            guard: PAID,
            effects: [
                E.recordFederalVehicleId,
                E.registerVehicle,
                E.assignRegistrationPlate,
                `${E.issueLibre}:${REGISTRATION_CERTIFICATE_TEMPLATE}`
            ]
        },
        {
            from: 'booklet',
            to: 'registered',
            action: 'issue_booklet',
            label: text('ደብተሩን ስጥ', 'Issue the booklet'),
            guard: PAID,
            effects: [E.issueLibreBooklet]
        },
        WITHDRAW,
        {
            from: ['review', 'approval', 'registration'],
            to: 'rejected',
            action: 'reject',
            label: text('ውድቅ አድርግ', 'Reject'),
            rejectRoles: REJECT_ROLES,
            commentRequired: true,
            // the plate held for the case goes back to the office's stock
            effects: [E.releaseRegistrationPlate]
        }
    ]
});

/** DVC-01 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importVehicleServices(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = NEW_REGISTRATION_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('አዲስ የተሽከርካሪ ምዝገባ', 'New vehicle registration');
    const entry = await publishedForm(
        tx,
        root,
        'vehicle-national-entry',
        text('የብሔራዊ ምዝገባ መረጃ', 'National registration entry'),
        NATIONAL_ENTRY_FORM
    );
    const booklet = await publishedForm(
        tx,
        root,
        'vehicle-libre-booklet',
        text('የሊብሬ ደብተር', 'Libre booklet'),
        LIBRE_BOOKLET_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-registration', name, VEHICLE_REGISTRATION_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-registration',
            name,
            vehicleRegistrationFlow(`vehicle-national-entry@${entry.number}`, `vehicle-libre-booklet@${booklet.number}`)
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-01-registration')
    });
    return 1;
}
