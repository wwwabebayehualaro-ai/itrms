/**
 * The plate exchange (DVC-12, task 1.2c, Directive 1050/2025) as configuration: its two forms, its workflow and the fee rule it
 * names, and nothing else. The vehicle is picked from the register (one not there is back-captured from its paper file first,
 * MIG-01). Like the other services it only ever makes a first version, and leaves what a bureau has published alone.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@itrms/kernel/db';
import { serviceDefinitions } from '@itrms/services/api';
import type { I18nText } from '@itrms/schemas';
import { VEHICLE_USES } from '@itrms/vehicles/contracts';
import vehiclesAm from '@itrms/vehicles/messages/am';
import vehiclesEn from '@itrms/vehicles/messages/en';

import { EXCHANGE_EFFECTS as X, PLATE_EXCHANGE_SERVICE, REGISTRATION_EFFECTS as E } from '../contracts';
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

const words = (key: string): I18nText => ({
    am: (vehiclesAm as Record<string, string>)[key] ?? key,
    en: (vehiclesEn as Record<string, string>)[key] ?? key
});

/**
 * The request, filed at the counter: the vehicle from the register, and its use as the old plate's code says it (the fee is worked
 * out from it, and the check compares it with the register). The owner's identity and the libre are kept as attachments.
 */
export const PLATE_EXCHANGE_FORM = {
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
        attachment('ownerIdentity', text('የባለቤቱ መታወቂያ', 'Owner identity document')),
        attachment('libreCopy', text('የሊብሬ ቅጂ', 'Copy of the libre'), 'internal'),
        FEE
    ]
};

/** The exchange step's answers: the federal vehicle id the national system gave, and the plate handed over if not the held one. */
export const PLATE_HANDOVER_FORM = {
    schemaVersion: 2,
    fields: [
        field(
            'federalVehicleId',
            'InputText',
            text('የፌዴራል ተሽከርካሪ መለያ', 'Federal vehicle id'),
            { required: false, maxLength: 40 },
            {
                classification: 'internal'
            }
        ),
        field(
            'replacementPlate',
            'InputText',
            text('የተሰጠው ሰሌዳ (ከተያዘው የተለየ ከሆነ)', 'Plate handed over (if not the reserved one)'),
            { required: false, maxLength: 40 },
            { classification: 'internal' }
        )
    ]
};

/**
 * DVC-12: documents, payment, approval (a national plate is held from then on), then the officer hands it over and the old plate is
 * retired, linked to it. A rejection gives the held plate back.
 */
export const plateExchangeFlow = (handoverForm: string) => ({
    schemaVersion: 1,
    states: [
        DRAFT,
        task('review', REVIEW_LABEL, 'competency.officer', 1),
        { key: 'payment', kind: 'wait', label: text('ክፍያ በመጠበቅ ላይ', 'Waiting for payment'), sla: { businessDays: 30 } },
        {
            key: 'approval',
            kind: 'task',
            label: text('የመጨረሻ ማጽደቅ', 'Final approval'),
            assignee: { role: 'competency.lead', unit: '${approval_unit}' },
            separationOfDuties: ['draft', 'review'],
            sla: { businessDays: 2 }
        },
        task('exchange', text('ሰሌዳ መቀየር', 'Plate exchange'), 'competency.officer', 2, {
            stepForm: handoverForm,
            separationOfDuties: ['approval']
        }),
        { key: 'exchanged', kind: 'end', label: text('ሰሌዳው ተቀይሯል', 'Plate exchanged') },
        { key: 'rejected', kind: 'end', label: text('ውድቅ ሆኗል', 'Rejected') }
    ],
    transitions: [
        { from: 'draft', to: 'review', action: 'submit', effects: [X.checkPlateExchange] },
        {
            from: 'draft',
            to: 'review',
            action: 'correct',
            label: ACTIONS.correct,
            amendsRequest: true,
            effects: ['fees.assess', X.checkPlateExchange]
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
            to: 'exchange',
            action: 'approve',
            label: ACTIONS.approve,
            guard: PAID,
            effects: [E.reserveRegistrationPlate]
        },
        {
            from: 'exchange',
            to: 'exchanged',
            action: 'exchange',
            label: text('ሰሌዳውን ስጥ', 'Hand over the plate'),
            guard: PAID,
            effects: [X.exchangePlate]
        },
        WITHDRAW,
        {
            from: ['review', 'approval', 'exchange'],
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

/** DVC-12 at the region's root. Needs the catalogue and the fee rules seeded first. Returns how many services changed. */
export async function importPlateExchangeService(tx: Tx, root: { id: string; regionId: string }): Promise<number> {
    const code = PLATE_EXCHANGE_SERVICE;
    const [service] = await tx
        .select()
        .from(serviceDefinitions)
        .where(and(eq(serviceDefinitions.regionId, root.regionId), eq(serviceDefinitions.code, code)))
        .for('update');
    if (!service) throw new Error(`service ${code}: seed the catalogue first`);
    if (service.currentVersionId) return 0;
    const name = text('የሰሌዳ ቅያሪ', 'Plate exchange');
    const handover = await publishedForm(
        tx,
        root,
        'vehicle-plate-handover',
        text('የሰሌዳ ርክክብ', 'Plate handover'),
        PLATE_HANDOVER_FORM
    );
    const form = await publishedForm(tx, root, 'vehicle-plate-exchange', name, PLATE_EXCHANGE_FORM);
    await firstServiceVersion(tx, root, service, {
        formVersionId: form.versionId,
        workflowVersionId: await workflowVersion(
            tx,
            root,
            'vehicle-plate-exchange',
            name,
            plateExchangeFlow(`vehicle-plate-handover@${handover.number}`)
        ),
        feeRuleVersionId: await approvedFeeRule(tx, root.regionId, 'dvc-12-plate-exchange')
    });
    return 1;
}
