/**
 * The driver licence family, part 1 (task 1.6, ADR-0051, ADR-0052, ADR-0064): the regional licence number, the card's serial
 * and the blood group.
 *
 * A licence the region numbers takes the next value of one counter on the region's root unit, `<region code>-<seq:05>`
 * ("06-00001"), unless the national platform gives a number; scope `unit` keeps the office's `{unit}/DL/{seq:06}`. The blood
 * group is a health fact (ADR-0052): field-encrypted, recorded by a register command and read in clear only through the audited
 * reveal. Everywhere else a licence says only whether one is on record.
 */
import { z } from 'zod';

/** How the region numbers its licences (ADR-0051 §2–4); the region code and the first number are the bureau's (Z). */
export const LICENCE_NUMBER_SETTING = 'competency.licence_number';
/** Whether the region collects the blood group for the card (ADR-0052, ADR-0064 §4): off until it says so (Z). */
export const CARD_SHOWS_BLOOD_GROUP_SETTING = 'competency.card_shows_blood_group';

export const LICENCE_NUMBER_SCOPES = ['region', 'unit'] as const;

/** A region code is two digits ("06" is South Ethiopia, ADR-0051). */
const isRegionCode = (text: string) => text.length === 2 && [...text].every((c) => c >= '0' && c <= '9');

export const licenceNumberingSchema = z.strictObject({
    scope: z.enum(LICENCE_NUMBER_SCOPES),
    regionCode: z.string().refine(isRegionCode, 'is two digits').optional(),
    /** the first number of the range the region reserves for ITRMS (ADR-0051 §4) */
    firstNumber: z.number().int().min(1).max(99_999_999).optional()
});
export type LicenceNumbering = z.infer<typeof licenceNumberingSchema>;

/** ADR-0051 §3: one regional sequence unless the region numbers per office; the code and the start are the region's to set. */
export const LICENCE_NUMBERING_DEFAULT: LicenceNumbering = { scope: 'region' };

/** The regional counter's pattern: the region code and the sequence, five digits ("06-00001"). */
export const regionalLicencePattern = (regionCode: string) => `${regionCode}-{seq:05}`;

/**
 * What a region's counter is set up from, or why it cannot be: region scope needs the code and the first number (an installation
 * that has not agreed its range with the bureau must not start numbering, ADR-0051 §4).
 */
export function regionalCounterSetup(
    numbering: LicenceNumbering
): { pattern: string; startAfter: bigint } | { problem: string } | null {
    if (numbering.scope !== 'region') return null;
    if (!numbering.regionCode || numbering.firstNumber === undefined)
        return {
            problem: `${LICENCE_NUMBER_SETTING}: the region numbers its licences, so set its regionCode and firstNumber first`
        };
    return {
        pattern: regionalLicencePattern(numbering.regionCode),
        startAfter: BigInt(numbering.firstNumber - 1)
    };
}

// ---- the card serial ----

export const CARD_SERIAL_MAX = 20;

/**
 * A card serial as printed: 1–20 letters, digits or '-'. Checked character by character (no pattern over what a person typed,
 * SEC regex_dos).
 */
export function isCardSerial(text: string): boolean {
    if (text.length < 1 || text.length > CARD_SERIAL_MAX) return false;
    for (const c of text) {
        const letter = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        const digit = c >= '0' && c <= '9';
        if (!letter && !digit && c !== '-') return false;
    }
    return true;
}

/** How a serial is kept and compared: as the stationery keeps a blank's key, in capitals. */
export const foldCardSerial = (text: string) => text.trim().toUpperCase();

export const cardSerialQuery = z
    .string()
    .trim()
    .min(1)
    .max(CARD_SERIAL_MAX)
    .refine(isCardSerial, 'is not a card serial')
    .transform(foldCardSerial);

// ---- the blood group ----

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** `POST /competency/licences/:id/health`: the blood group the holder's card will carry. */
export const licenceHealthRecordSchema = z.strictObject({ bloodGroup: z.enum(BLOOD_GROUPS) });

/** `POST /competency/licences/:id/health/reveal`: why the lead needs to read it (kept in the audit log). */
export const licenceHealthRevealSchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });

/** What a reveal shows: the blood group, or none on record. */
export const licenceHealthRevealedSchema = z.object({ bloodGroup: z.enum(BLOOD_GROUPS).nullable() });
export type LicenceHealthRevealed = z.infer<typeof licenceHealthRevealedSchema>;

/** The audit event of a reveal (ADR-0052): on record before the read, even when the read then fails. */
export const LICENCE_HEALTH_REVEALED_EVENT = 'licence.health_revealed';
