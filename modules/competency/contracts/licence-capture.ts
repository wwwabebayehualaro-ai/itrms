/**
 * The back-capture of a paper driver licence (MIG-02, ADR-0054, ADR-0051 §4, ADR-0064 §6, task 1.6b): a licence with no electronic
 * record is captured from its paper file with the number and the card serial printed on it, verified against the paper by a second
 * person, and only then joins the register, marked as migrated and active without a national reference (task 1.14 reconciles it).
 * A printed number is never renumbered: one inside the range the region reserved for ITRMS's own numbers, or one another licence of
 * the region already carries, is refused and flagged to the bureau.
 */
import { z } from 'zod';

import type { LicenceNumbering } from './licence-family';
import { addYears, LATE_RENEWAL_YEARS } from './rules';

export const LICENCE_CAPTURE_EFFECTS = {
    checkLicenceCapture: 'competency.checkLicenceCapture',
    captureLicence: 'competency.captureLicence',
    flagLicenceNumber: 'competency.flagLicenceNumber'
} as const;

/** The service's code in the catalogue: the migration's own, beside the vehicles' MIG-01. */
export const LICENCE_CAPTURE_SERVICE = 'MIG-02';

/** Why a printed number cannot join the register as it is. */
export const LICENCE_NUMBER_CONFLICTS = ['in_regional_range', 'number_taken'] as const;
export type LicenceNumberConflict = (typeof LICENCE_NUMBER_CONFLICTS)[number];

/** The notice the case page shows on a capture whose number cannot join the register (facts.licenceCapture.notices). */
export const LICENCE_NUMBER_CONFLICT_NOTICE = 'competency.licenceCapture.numberConflict';
/** The notices on a capture of a licence past its expiry: it joins as expired, and over a year late its renewal needs a practical exam. */
export const LICENCE_CAPTURE_EXPIRED_NOTICE = 'competency.licenceCapture.expired';
export const LICENCE_CAPTURE_EXAM_NOTICE = 'competency.licenceCapture.renewalNeedsExam';

/**
 * Which expired paper licences a region captures (`competency.licence_capture_expired`). Proclamation 1074/2018 keeps an expired
 * licence renewable, with a practical exam once it is more than a year late (Art. 19(5)), so the default captures every one: refusing
 * it would send its holder to a new application the law does not ask for. A region may capture only those still renewable without
 * the exam (`refuse_late`), or none past expiry (`refuse`).
 */
export const LICENCE_CAPTURE_EXPIRED_SETTING = 'competency.licence_capture_expired';
export const LICENCE_CAPTURE_EXPIRED_POLICIES = ['accept', 'refuse_late', 'refuse'] as const;
export type LicenceCaptureExpiredPolicy = (typeof LICENCE_CAPTURE_EXPIRED_POLICIES)[number];
export const licenceCaptureExpiredSchema = z.enum(LICENCE_CAPTURE_EXPIRED_POLICIES);
export const LICENCE_CAPTURE_EXPIRED_DEFAULT: LicenceCaptureExpiredPolicy = 'accept';

/** How far past its expiry a licence is on a day, as a renewal counts it (renewalTerms: Art. 19(5)). */
export const lapseOf = (validUntil: string, today: string) => ({
    expired: validUntil < today,
    lateOverYear: addYears(validUntil, LATE_RENEWAL_YEARS) < today
});

export const PAPER_LICENCE_NUMBER_MAX = 30;

/**
 * A licence number as a paper licence prints it: 1–30 letters (Latin or Ethiopic), digits, '-' or '/' ("06-01234", an old booklet's
 * grade prefix, an office's own series). Checked character by character (no pattern over what a person typed, SEC regex_dos).
 */
export function isPaperLicenceNumber(text: string): boolean {
    if (text.length < 1 || text.length > PAPER_LICENCE_NUMBER_MAX) return false;
    for (const c of text) {
        const letter = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= 'ሀ' && c <= 'ፚ');
        const digit = c >= '0' && c <= '9';
        if (!letter && !digit && c !== '-' && c !== '/') return false;
    }
    return true;
}

/** How a printed number is kept and compared: trimmed, in capitals. */
export const foldLicenceNumber = (text: string) => text.trim().toUpperCase();

const allDigits = (text: string) => text.length > 0 && [...text].every((c) => c >= '0' && c <= '9');

/**
 * Whether a printed number is one ITRMS gives itself (ADR-0051 §4), so a paper licence cannot carry it: in region scope, the region
 * code, '-' and a sequence at or past the first number of the reserved range; in either scope, an office's own series
 * (`{unit}/DL/{seq:06}`). A region that has not set its code yet reserves nothing in region scope.
 */
export function inLicenceRange(number: string, numbering: LicenceNumbering): boolean {
    const folded = foldLicenceNumber(number);
    const slash = folded.split('/');
    const officeSeries =
        slash.length === 3 && slash[0] !== '' && slash[1] === 'DL' && slash[2]?.length === 6 && allDigits(slash[2]);
    if (officeSeries) return true;
    if (numbering.scope !== 'region' || !numbering.regionCode || numbering.firstNumber === undefined) return false;
    const prefix = `${numbering.regionCode}-`;
    if (!folded.startsWith(prefix)) return false;
    const seq = folded.slice(prefix.length);
    return allDigits(seq) && Number(seq) >= numbering.firstNumber;
}

/** A grade the paper licence carries, and since when it is permanent (when the paper says). */
export const capturedGradeSchema = z.object({
    grade: z.string().min(1).max(40),
    permanentSince: z.iso.date().nullish()
});

/** The capture's facts an effect reads, by contract path (see licence-capture.effects.ts). */
export type LicenceCaptureInput = {
    paperReference: string;
    paperFileScan?: unknown;
    person: string;
    number: string;
    cardSerial?: string;
    kind: string;
    issuedOn: string;
    validUntil: string;
    /** the licensing office or region that issued it, as the paper names it */
    issuedBy?: string;
    grades: unknown[];
};

/** As the register keeps a licence's kind (LICENCE_KINDS). */
export const licenceKindSchema = z.enum(['temporary', 'permanent']);

/** A flagged printed number, as the bureau reads it. */
export const licenceNumberFlagSchema = z.object({
    id: z.uuid(),
    number: z.string(),
    reason: z.enum(LICENCE_NUMBER_CONFLICTS),
    caseId: z.uuid(),
    caseNumber: z.number().int().nullable(),
    paperReference: z.string(),
    handlingUnit: z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) }),
    note: z.string().nullable(),
    flaggedAt: z.string()
});
export type LicenceNumberFlag = z.infer<typeof licenceNumberFlagSchema>;
export const licenceNumberFlagListSchema = z.object({ items: z.array(licenceNumberFlagSchema) });
export const licenceNumberFlagQuerySchema = z.strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(50)
});
