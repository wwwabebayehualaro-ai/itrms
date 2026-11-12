/**
 * The new vehicle registration service (DVC-01, task 1.2b): the effects its workflow names, the libre it issues and the fee it
 * charges. The vehicle register is the vehicles slice's; these are the competency work process's steps over it.
 */
import { z } from 'zod';

export const REGISTRATION_EFFECTS = {
    checkVehicleRegistration: 'competency.checkVehicleRegistration',
    reserveRegistrationPlate: 'competency.reserveRegistrationPlate',
    recordFederalVehicleId: 'competency.recordFederalVehicleId',
    registerVehicle: 'competency.registerVehicle',
    assignRegistrationPlate: 'competency.assignRegistrationPlate',
    issueLibre: 'competency.issueLibre',
    issueLibreBooklet: 'competency.issueLibreBooklet',
    releaseRegistrationPlate: 'competency.releaseRegistrationPlate'
} as const;

/**
 * The document a registration issues: the registration certificate, the zone's temporary libre (ADR-0050). The libre itself
 * is the federal booklet, from the office's stationery.
 */
export const REGISTRATION_CERTIFICATE_TEMPLATE = 'vehicle-registration-certificate';

/** The service's code in the catalogue. */
export const NEW_REGISTRATION_SERVICE = 'DVC-01';

/** One owner of a registration request: a person or an organisation, and exactly one of them (the effect refuses any other). */
export const ownerRowSchema = z.looseObject({
    ownerPerson: z.uuid().nullish(),
    ownerOrganisation: z.uuid().nullish()
});

/** What the second step of the workflow says: the federal id of the national system and, if the plate on hand is not the reserved one, which. */
export const nationalEntrySchema = z.object({
    federalVehicleId: z.string().optional(),
    replacementPlate: z.string().trim().optional()
});

/**
 * What the booklet step says (ADR-0050): the booklet written in, when it is not the office's next one; the national reference
 * when the national system gave one; and the booklets spoiled on the way, each with its reason (kept on record, never reissued).
 */
export const bookletEntrySchema = z.object({
    bookletSerial: z.string().trim().max(40).optional(),
    libreNationalReference: z.string().trim().max(60).optional(),
    spoiledBooklets: z
        .array(
            z.looseObject({
                spoiledSerial: z.string().trim().min(1).max(40),
                spoiledReason: z.string().trim().min(3).max(500)
            })
        )
        .max(20)
        .optional()
});
