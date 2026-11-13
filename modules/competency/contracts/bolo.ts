/**
 * The annual technical inspection and its bolo (task 1.3a, DVC-02): a vehicle on the register is inspected on the bureau's
 * checklist (a `Checklist` field, task 1.13a), and a passed inspection makes one bolo, valid to the end of the Ethiopian fiscal
 * year it was inspected in. The sticker of the vehicle's use and that year comes from the office's stationery; when none is in
 * stock the office gives a temporary bolo for a few days and the sticker later, on the same case.
 */
import { fiscalYearOf, fiscalYearRange, toEthiopian, toGregorian } from '@itrms/ethiopian-calendar';
import { z } from 'zod';

export const BOLO_EFFECTS = {
    checkBolo: 'competency.checkBolo',
    recordBoloInspection: 'competency.recordBoloInspection',
    issueBoloSticker: 'competency.issueBoloSticker',
    issueTemporaryBolo: 'competency.issueTemporaryBolo'
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

const iso = (d: { year: number; month: number; day: number }) =>
    `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * The fiscal year a bolo stands for and its last day: the Ethiopian fiscal year the vehicle was inspected in, to Sene 30 (the
 * stickers are printed per fiscal year). A stated rule until the zone says a category differs (asked: docs/discovery Q12).
 */
export function boloValidity(inspectedOn: string): { fiscalYear: number; validUntil: string } {
    const [year, month, day] = inspectedOn.split('-').map(Number);
    if (!year || !month || !day) throw new Error(`not a day: ${inspectedOn}`);
    const fiscalYear = fiscalYearOf(toEthiopian({ year, month, day }));
    return { fiscalYear, validUntil: iso(toGregorian(fiscalYearRange(fiscalYear).end)) };
}

/** The day a number of days after a Gregorian day (a temporary bolo's last day). */
export function daysAfter(day: string, days: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

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

/** What the inspection step says: the checklist sheet's own serial and the day the vehicle was inspected. */
export const inspectionEntrySchema = z.object({
    checklistSerial: z.string().trim().min(1).max(40),
    inspectedOn: z.iso.date()
});
