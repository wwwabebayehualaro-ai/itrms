/**
 * The ownership transfer (task 1.4b, DVC-13): a vehicle on the register changes hands by sale, gift, inheritance, court order or
 * auction. The sellers are the register's current owners; the request names the buyers. The office checks the vehicle against
 * the paper inspection and sets its value with a committee (the value is the committee's: ITRMS never computes a tax or a duty),
 * writes the letters the other offices ask for (the justice office authenticates the contract, the revenue office sets the
 * stamp duty, the tax office registers a code-3 owner), records the authenticated papers, takes the fee, and then moves the
 * ownership in the register and issues the new libre. The register is the vehicles slice's; these are the steps over it.
 */
import { z } from 'zod';

export const TRANSFER_EFFECTS = {
    checkOwnershipTransfer: 'competency.checkOwnershipTransfer',
    recordValuation: 'competency.recordValuation',
    issueTransferLetters: 'competency.issueTransferLetters',
    recordTransferEvidence: 'competency.recordTransferEvidence',
    transferOwnership: 'competency.transferOwnership',
    revokeTransferLetters: 'competency.revokeTransferLetters'
} as const;

/** The service's code in the catalogue: not in the source list, the name change the zone's fee sheet prices (task 1.4b). */
export const OWNERSHIP_TRANSFER_SERVICE = 'DVC-13';

/** How the buyers came by the vehicle: the register's own reasons, less the first registration and the back-capture of a paper file. */
export const TRANSFER_ACQUIRED_BY = ['sale', 'gift', 'inheritance', 'court_order', 'auction'] as const;
export type TransferAcquiredBy = (typeof TRANSFER_ACQUIRED_BY)[number];

/** The office counter the transfer letters are numbered from, and its pattern: `{unit code}/OT/00012/2019`. */
export const TRANSFER_LETTER_COUNTER = 'competency.transfer-letter';
export const TRANSFER_LETTER_PATTERN = '{unit}/OT/{seq:05}/{efy}';

/** The letters the office writes to the other offices, by the office they go to. */
export const TRANSFER_LETTER_KINDS = ['justice', 'revenue', 'tax'] as const;
export type TransferLetterKind = (typeof TRANSFER_LETTER_KINDS)[number];
export const TRANSFER_LETTER_TEMPLATES = {
    justice: 'vehicle-transfer-justice-letter',
    revenue: 'vehicle-transfer-revenue-letter',
    tax: 'vehicle-transfer-tax-letter'
} as const satisfies Record<TransferLetterKind, string>;

/** How many days a transfer letter stands (a region's or an office's setting; 30 until the bureau says: a stated assumption). */
export const TRANSFER_LETTER_VALID_DAYS_SETTING = 'competency.transfer_letter_valid_days';
export const DEFAULT_TRANSFER_LETTER_DAYS = 30;

/** The whole Birr a committee may set: a value above ten billion is a typing error, not a vehicle. */
export const MAX_VALUATION_BIRR = 10_000_000_000;

/** A box left empty is no value. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullish()
        .transform((v) => (v ? v : undefined));

/**
 * What the valuation step says: whether the vehicle is as the paper inspection says, the figures the committee looked at (whole
 * Birr; the service checks their range and keeps them in santim) and the value it set. No tax or duty is worked out from them.
 */
export const valuationEntrySchema = z.object({
    inspectionMatches: z.boolean(),
    inspectionNote: optionalText(500),
    purchasePriceBirr: z
        .number()
        .nullish()
        .transform((v) => v ?? undefined),
    marketValueBirr: z
        .number()
        .nullish()
        .transform((v) => v ?? undefined),
    contractValueBirr: z
        .number()
        .nullish()
        .transform((v) => v ?? undefined),
    depreciationPercent: z
        .number()
        .min(0)
        .max(100)
        .nullish()
        .transform((v) => v ?? undefined),
    committeeValueBirr: z.number(),
    valuers: optionalText(200)
});
export type ValuationEntry = z.infer<typeof valuationEntrySchema>;

/** What the letters step says: the offices the letters go to (the service requires the justice office for a sale or a gift, the tax office for code 3). */
export const lettersEntrySchema = z.object({
    justiceOffice: optionalText(120),
    revenueOffice: z.string().trim().min(1).max(120),
    taxOffice: optionalText(120)
});
export type LettersEntry = z.infer<typeof lettersEntrySchema>;

/** What the outside step says: the papers that came back from the other offices. The files belong to the step's own submission. */
export const evidenceEntrySchema = z.object({
    contractReference: optionalText(60),
    contractAuthenticatedOn: z.iso
        .date()
        .nullish()
        .transform((v) => v ?? undefined),
    authenticatedContract: z.unknown().optional(),
    stampDutyReceipt: z.string().trim().min(1).max(60),
    stampDutyPaidOn: z.iso.date(),
    stampDutyReceiptFile: z.unknown().optional(),
    taxRegistrationReference: optionalText(60),
    courtReference: optionalText(60)
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;
