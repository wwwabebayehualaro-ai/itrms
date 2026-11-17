/**
 * A vehicle moved between two offices of the region (task 1.4c, ADR-0057): DVC-14, the transfer out, filed at the office that
 * handles it, names the office it goes to and, paid and approved, releases it; DVC-15, the transfer in, filed at that office,
 * receives it. On receipt the vehicle and its live records move to the receiving office, never a copy. The rules a bureau may
 * set are settings and service configuration: how long a release stands, whether the receiving office inspects the vehicle
 * again, the fee of each service and the documents asked for.
 */
import { z } from 'zod';

export const VEHICLE_TRANSFER_EFFECTS = {
    checkTransferOut: 'competency.checkTransferOut',
    releaseVehicle: 'competency.releaseVehicle',
    checkTransferIn: 'competency.checkTransferIn',
    recordTransferInspection: 'competency.recordTransferInspection',
    receiveVehicle: 'competency.receiveVehicle'
} as const;

/** The services' codes in the catalogue: not in the source list as separate codes (the zone's "leaving or entering the zone"). */
export const TRANSFER_OUT_SERVICE = 'DVC-14';
export const TRANSFER_IN_SERVICE = 'DVC-15';

/** How many days a release stands for the receiving office (the zone's transfer document: 15). */
export const VEHICLE_TRANSFER_VALID_DAYS_SETTING = 'competency.vehicle_transfer_valid_days';
export const DEFAULT_VEHICLE_TRANSFER_DAYS = 15;

/** Whether the receiving office inspects the vehicle again before it receives it (no, until the zone says). */
export const VEHICLE_TRANSFER_REINSPECT_SETTING = 'competency.vehicle_transfer_reinspect';

/** The receiving office's inspection: the vehicle is the one the release names, as its record says. */
export const transferInspectionEntrySchema = z.object({
    inspectionMatches: z.boolean(),
    inspectionNote: z.string().trim().min(1).max(500).optional()
});
export type TransferInspectionEntry = z.infer<typeof transferInspectionEntrySchema>;
