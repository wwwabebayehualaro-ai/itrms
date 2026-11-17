/**
 * A vehicle handed from one office to another of the region (task 1.4c, ADR-0057): the source's transfer out releases it to the
 * destination, which receives it with its transfer in; on receipt the vehicle's handling unit and its live rows move, never a
 * copy. A release stands until its day (`validUntil`); one not received by then is expired by the next release.
 */
import { z } from 'zod';

export const HANDOVER_STATUSES = ['released', 'received', 'expired'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

/** Where a release goes: an office of the region (it receives it), or outside it (ADR-0058: another region, or an office without ITRMS). */
export const HANDOVER_DESTINATIONS = ['office', 'outside'] as const;
export type HandoverDestination = (typeof HANDOVER_DESTINATIONS)[number];

const isoDate = z.iso.date();

export const vehicleHandoverSchema = z.object({
    id: z.uuid(),
    vehicleId: z.uuid(),
    fromUnitId: z.uuid(),
    /** null for a release outside the region */
    toUnitId: z.uuid().nullable(),
    destinationKind: z.enum(HANDOVER_DESTINATIONS),
    destinationName: z.string().nullable(),
    destinationRegion: z.string().nullable(),
    status: z.enum(HANDOVER_STATUSES),
    releasedOn: isoDate,
    validUntil: isoDate,
    receivedOn: isoDate.nullable()
});
export type VehicleHandover = z.infer<typeof vehicleHandoverSchema>;
