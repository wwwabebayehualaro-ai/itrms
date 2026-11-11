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
    releaseRegistrationPlate: 'competency.releaseRegistrationPlate'
} as const;

/** The document a registration prints as: the libre (ADR-0049). */
export const VEHICLE_LIBRE_TEMPLATE = 'vehicle-libre';

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
