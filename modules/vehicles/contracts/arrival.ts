/**
 * A vehicle that arrived from another region (task 1.4c3, ADR-0060): registered by DVC-17 on the vehicle data transfer document
 * its owner brought. ITRMS installations are not linked, so what the document says is kept as the officer read it (the number, the
 * body that issued it and the days it stands, how it was checked, the plate it carried, the bolo and the holds it lists): the
 * register never fetches anything from the other side.
 */
import { z } from 'zod';

/** How the officer checked the document: on the issuing body's verification page, or by a letter to it. */
export const ARRIVAL_VERIFIED_HOW = ['verification_page', 'letter'] as const;
export type ArrivalVerifiedHow = (typeof ARRIVAL_VERIFIED_HOW)[number];

/** A document number, or the name of the region that issued it, as compared: no spaces, upper case. */
export const arrivalKey = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

const isoDate = z.iso.date();

/** The command that records an arrival's document, beside the vehicle's own registration (the register's service, no endpoint). */
export const arrivalRecordSchema = z.strictObject({
    vehicleId: z.uuid(),
    caseId: z.uuid(),
    documentNumber: z.string().trim().min(1).max(60),
    issuingRegion: z.string().trim().min(1).max(100),
    issuingOffice: z.string().trim().min(1).max(200),
    documentDate: isoDate,
    validUntil: isoDate,
    verifiedHow: z.enum(ARRIVAL_VERIFIED_HOW),
    arrivedOn: isoDate,
    /** the plate the vehicle arrived on, as written (an old regional plate that is then exchanged, or the one it keeps) */
    carriedPlateText: z.string().trim().min(1).max(60).optional(),
    carriedPlateKey: z
        .string()
        .regex(/^[A-Z0-9]{3,40}$/)
        .optional(),
    /** the other region's bolo, as a fact only: no bolo of this region is made from it */
    boloValidUntil: isoDate.optional(),
    holdsListed: z.boolean().default(false),
    holdsNote: z.string().trim().min(1).max(500).optional()
});
export type ArrivalRecord = z.input<typeof arrivalRecordSchema>;
