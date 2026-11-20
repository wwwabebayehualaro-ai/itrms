/**
 * The driver licence family, part 2 (task 1.6a, ADR-0052, ADR-0064 §4): a renewal's medical examination. The office writes a
 * referral letter to a health facility (numbered from the office's counter, with a QR), or the holder brings a report. The health
 * bureau's "Drivers physical examination report" comes back with the facility, the day, its number and the recommendation: grant,
 * grant with conditions, or refuse. Only those are typed; the findings stay on the paper. The conditions are a health fact: never a
 * form answer, recorded by a command into a field-encrypted column and read in clear only through the audited reveal. A refused
 * report may go to a second and a third institution (Proclamation 1074/2018 Art. 13); after the third the renewal can only be
 * rejected.
 */
import { z } from 'zod';

export const MEDICAL_EFFECTS = {
    /** the referral letter to the facility named on the step (argument none) */
    issueMedicalReferral: 'competency.issueMedicalReferral',
    /** the report as it came back; `:fit` takes grant or grant with conditions, `:unfit` takes refuse */
    recordMedicalReport: 'competency.recordMedicalReport'
} as const;

/** The health bureau's recommendation (the report's last box). */
export const MEDICAL_RECOMMENDATIONS = ['grant', 'grant_with_conditions', 'refuse'] as const;
export type MedicalRecommendation = (typeof MEDICAL_RECOMMENDATIONS)[number];

/** Art. 13: a disputed result may go to a second and a third institution, so a case has at most three reports. */
export const MAX_MEDICAL_INSTITUTIONS = 3;

/** The referral letters' counter at an office, and its pattern: `{unit code}/MR/00012/2019`. */
export const MEDICAL_REFERRAL_COUNTER = 'competency.medical-referral';
export const MEDICAL_REFERRAL_PATTERN = '{unit}/MR/{seq:05}/{efy}';
export const MEDICAL_REFERRAL_TEMPLATE = 'licence-medical-referral';

/** The longest a facility's name or the report's number may be. */
export const MEDICAL_FACILITY_MAX = 120;
export const MEDICAL_REPORT_NUMBER_MAX = 40;
export const MEDICAL_CONDITIONS_MAX = 500;

/** A box left empty is no value. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullish()
        .transform((v) => (v ? v : undefined));

/** The referral step's answers: the facility the holder is sent to. */
export const medicalReferralEntrySchema = z.object({
    institution: z.string().trim().min(2).max(MEDICAL_FACILITY_MAX)
});

/** The report step's answers: what the report says of itself, and its recommendation. No finding is asked for. */
export const medicalReportEntrySchema = z.object({
    facility: z.string().trim().min(2).max(MEDICAL_FACILITY_MAX),
    examinedOn: z.iso.date(),
    reportNumber: optionalText(MEDICAL_REPORT_NUMBER_MAX),
    recommendation: z.enum(MEDICAL_RECOMMENDATIONS)
});
export type MedicalReportEntry = z.infer<typeof medicalReportEntrySchema>;

/** The case's fact `medical`, which the workflow's guards read. */
export interface MedicalFacts {
    /** reports recorded on the case, 1–3 */
    reports: number;
    /** of them, refused */
    refusals: number;
    /** referral letters written */
    referrals: number;
    /** the last report's recommendation */
    latest: MedicalRecommendation | null;
    /** the day the standing referral was written: a report answering it is dated on or after it */
    referredOn: string | null;
}

/** Folded for comparison: one facility is not a second institution because it was typed in other capitals or spacing. */
export const foldFacility = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

// ---- the conditions, by command ----

/** `POST /competency/medical-reports/:id/conditions`: the conditions the report grants with, as the facility wrote them. */
export const medicalConditionsRecordSchema = z.strictObject({
    conditions: z.string().trim().min(2).max(MEDICAL_CONDITIONS_MAX)
});

/** `POST /competency/medical-reports/:id/conditions/reveal`: why the lead needs to read them (kept in the audit log). */
export const medicalConditionsRevealSchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });

export const medicalConditionsRevealedSchema = z.object({ conditions: z.string().nullable() });
export type MedicalConditionsRevealed = z.infer<typeof medicalConditionsRevealedSchema>;

/** The audit event of a reveal (ADR-0052): on record before the read, even when the read then fails. */
export const MEDICAL_CONDITIONS_REVEALED_EVENT = 'licence.medical_conditions_revealed';

/** A case's reports as the case page lists them: whether conditions are on record, never what they are. */
export const medicalReportSchema = z.object({
    id: z.uuid(),
    sequence: z.number().int(),
    facility: z.string(),
    examinedOn: z.string(),
    reportNumber: z.string().nullable(),
    recommendation: z.enum(MEDICAL_RECOMMENDATIONS).nullable(),
    conditionsOnRecord: z.boolean(),
    version: z.number().int()
});
export type MedicalReport = z.infer<typeof medicalReportSchema>;
export const medicalReportListSchema = z.object({ items: z.array(medicalReportSchema) });
