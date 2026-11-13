/**
 * The annual technical inspection and its bolo (task 1.3a, DVC-02): a vehicle on the register is inspected on the bureau's
 * checklist (a `Checklist` field, task 1.13a), and a passed inspection makes one bolo, valid to the end of the Ethiopian fiscal
 * year it was inspected in. The sticker of the vehicle's use and that year comes from the office's stationery; when none is in
 * stock the office gives a temporary bolo for a few days and the sticker later, on the same case.
 */
import { z } from 'zod';

export const BOLO_EFFECTS = {
    checkBolo: 'competency.checkBolo',
    recordBoloInspection: 'competency.recordBoloInspection',
    issueBoloSticker: 'competency.issueBoloSticker',
    issueTemporaryBolo: 'competency.issueTemporaryBolo',
    voidBolo: 'competency.voidBolo'
} as const;

/** The service's code in the catalogue. */
export const BOLO_SERVICE = 'DVC-02';

/** The bolo document, and the temporary bolo a vehicle carries while the office has no sticker of its kind. */
export const BOLO_TEMPLATE = 'vehicle-bolo';
export const TEMPORARY_BOLO_TEMPLATE = 'vehicle-temporary-bolo';

/**
 * A bolo's life: made by the passed inspection (`awaiting_sticker`), carried on a temporary certificate (`temporary`) or its
 * sticker (`valid`); `void` when it was issued in error.
 */
export const BOLO_STATUSES = ['awaiting_sticker', 'temporary', 'valid', 'void'] as const;
export type BoloStatus = (typeof BOLO_STATUSES)[number];

/**
 * The uses whose bolo needs the Road Fund payment before it (the zone's answer Q12.3: plate codes 1 and 3, public transport and
 * freight); every use needs the insurance certificate, the driver's licence and the inspection receipt.
 */
export const ROAD_FUND_USES: readonly string[] = ['public_transport', 'commercial'];

/** The office's counter the temporary bolo's number comes from (the sticker's serial is the bolo's own number). */
export const TEMPORARY_BOLO_COUNTER = 'competency.temporary-bolo';
export const TEMPORARY_BOLO_PATTERN = '{unit}/TB/{seq:05}';

/** How many days a temporary bolo stands when the case's configuration does not say (`bolo_temporary_days`). */
export const DEFAULT_TEMPORARY_BOLO_DAYS = 30;

/**
 * The third-party insurance certificate (Proclamation 799/2013), as the request records it: its number, the insurer and the
 * policy period. A policy that has ended is refused.
 */
export const insuranceSchema = z.object({
    certificate: z.string().trim().min(1).max(40),
    insurer: z.string().trim().min(1).max(200),
    from: z.iso.date(),
    until: z.iso.date()
});
export type Insurance = z.infer<typeof insuranceSchema>;

/** What the inspection step says: the checklist sheet's own serial and the day the vehicle was inspected (today when not given). */
export const inspectionEntrySchema = z.object({
    checklistSerial: z.string().trim().min(1).max(40),
    inspectedOn: z.iso.date().optional()
});
