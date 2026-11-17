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
    /** the giving step of a transfer out of the region (ADR-0058): the document, and the vehicle reads `transferred_out` */
    releaseVehicleOut: 'competency.releaseVehicleOut',
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

/** Whether an office of this region that receives the vehicle is also sent the covering letter (off: it sees the release itself). */
export const VEHICLE_TRANSFER_COVERING_LETTER_SETTING = 'competency.vehicle_transfer_covering_letter';

/** Where the transfer out's request says the vehicle goes: an office of the region (the default), or outside it (ADR-0058). */
export const TRANSFER_OUT_DESTINATIONS = ['office', 'outside'] as const;
export type TransferOutDestination = (typeof TRANSFER_OUT_DESTINATIONS)[number];

/** The transfer document and its covering letter, numbered from one counter of the handling office. */
export const VEHICLE_TRANSFER_DOCUMENT_COUNTER = 'competency.transfer-document';
export const VEHICLE_TRANSFER_DOCUMENT_PATTERN = '{unit}/VT/{seq:05}/{efy}';
export const VEHICLE_TRANSFER_DOCUMENT_TEMPLATE = 'vehicle-transfer-document';
export const VEHICLE_TRANSFER_COVERING_LETTER_TEMPLATE = 'vehicle-transfer-covering-letter';

/** The most whole Birr the document may state (as the committee's valuation: above it is a typing error). */
export const MAX_TRANSFER_DOCUMENT_BIRR = 10_000_000_000;
/** The most earlier plates a document lists. */
export const MAX_EARLIER_PLATES = 10;

/** A box left empty is no value. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullish()
        .transform((v) => (v ? v : undefined));

const optionalBirr = z
    .number()
    .nullish()
    .transform((v) => v ?? undefined);

/**
 * What the document step says (ADR-0058): the papers the owner brought, the plates the vehicle carried before this register's
 * (the year is Ethiopian, checked by the service), and a remark. Whole Birr, kept as santim on the document.
 */
export const transferDocumentEntrySchema = z.object({
    customsDeclarationNumber: optionalText(40),
    taxReceiptNumber: optionalText(40),
    purchaseValueBirr: optionalBirr,
    excisePaidBirr: optionalBirr,
    earlierPlates: z
        .array(
            z.object({
                plate: z.string().trim().min(1).max(40),
                year: z.number(),
                place: z.string().trim().min(1).max(100)
            })
        )
        .max(MAX_EARLIER_PLATES)
        .nullish()
        .transform((v) => v ?? []),
    remarks: optionalText(500)
});
export type TransferDocumentEntry = z.infer<typeof transferDocumentEntrySchema>;

/** The receiving office's inspection: the vehicle is the one the release names, as its record says. */
export const transferInspectionEntrySchema = z.object({
    inspectionMatches: z.boolean(),
    inspectionNote: z.string().trim().min(1).max(500).optional()
});
export type TransferInspectionEntry = z.infer<typeof transferInspectionEntrySchema>;
