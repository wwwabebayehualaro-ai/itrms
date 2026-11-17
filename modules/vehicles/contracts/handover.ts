/**
 * A vehicle handed from one office to another of the region (task 1.4c, ADR-0057): the source's transfer out releases it to the
 * destination, which receives it with its transfer in; on receipt the vehicle's handling unit and its live rows move, never a
 * copy. A release stands until its day (`validUntil`); one not received by then is expired by the next release.
 */
import { z } from 'zod';

export const HANDOVER_STATUSES = ['released', 'received', 'expired'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

const isoDate = z.iso.date();

export const vehicleHandoverSchema = z.object({
    id: z.uuid(),
    vehicleId: z.uuid(),
    fromUnitId: z.uuid(),
    toUnitId: z.uuid(),
    status: z.enum(HANDOVER_STATUSES),
    releasedOn: isoDate,
    validUntil: isoDate,
    receivedOn: isoDate.nullable()
});
export type VehicleHandover = z.infer<typeof vehicleHandoverSchema>;
