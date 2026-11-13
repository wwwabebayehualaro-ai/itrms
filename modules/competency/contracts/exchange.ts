/**
 * The plate exchange (task 1.2c, DVC-12): an old regional plate exchanged for a national plate from the office's stock, as
 * Directive 1050/2025 asks of every vehicle already on the road. The register is the vehicles slice's; these are the competency
 * work process's steps over it. The plate is held and handed over by the registration's own effects (registration.ts).
 */
import { z } from 'zod';

export const EXCHANGE_EFFECTS = {
    checkPlateExchange: 'competency.checkPlateExchange',
    exchangePlate: 'competency.exchangePlate'
} as const;

/** The service's code in the catalogue: not in the source list, the plates part of DVC-01 under Directive 1050/2025. */
export const PLATE_EXCHANGE_SERVICE = 'DVC-12';

/** What the exchange step says: the federal vehicle id the national system gave, and the plate handed over if not the held one. */
export const exchangeEntrySchema = z.object({
    federalVehicleId: z.string().trim().optional(),
    replacementPlate: z.string().trim().optional()
});
