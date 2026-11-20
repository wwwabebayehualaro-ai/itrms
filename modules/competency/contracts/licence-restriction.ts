/**
 * The suspension and cancellation record of a driver licence (DVC-21, ADR-0064 §6, task 1.6c). ITRMS never decides one: it records the
 * deciding authority's decision (a court, the traffic police, the penalty system, a licensing body) by its reference, and a second
 * person approves the record. A suspension runs from a day to a day, shows in the register and blocks the other licence services while
 * it stands; a cancellation ends the licence and revokes its card document, whose QR then reports it revoked.
 */
import { z } from 'zod';

export const LICENCE_RESTRICTION_EFFECTS = {
    checkLicenceRestriction: 'competency.checkLicenceRestriction',
    recordLicenceRestriction: 'competency.recordLicenceRestriction'
} as const;

/** The service's code in the catalogue (ADR-0064 §5). */
export const LICENCE_RESTRICTION_SERVICE = 'DVC-21';

export const RESTRICTION_KINDS = ['suspension', 'cancellation'] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

/** Who decides (ADR-0064 §6): never ITRMS. */
export const RESTRICTION_AUTHORITIES = ['court', 'traffic_police', 'penalty_system', 'licensing_body'] as const;
export type RestrictionAuthority = (typeof RESTRICTION_AUTHORITIES)[number];

export const AUTHORITY_REFERENCE_MAX = 80;

/** The request's facts an effect reads, by contract path (see licence-restriction.effects.ts). */
export type LicenceRestrictionInput = {
    licence: string;
    kind: string;
    authority: string;
    authorityReference: string;
    decidedOn: string;
    startsOn: string;
    /** a suspension's last day; a cancellation has none */
    endsOn?: string;
    decisionScan?: unknown;
};

/** A restriction as the register shows it beside its licence. */
export const licenceRestrictionSchema = z.object({
    id: z.uuid(),
    kind: z.enum(RESTRICTION_KINDS),
    authority: z.enum(RESTRICTION_AUTHORITIES),
    authorityReference: z.string(),
    decidedOn: z.iso.date(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().nullable(),
    caseId: z.uuid()
});
export type LicenceRestriction = z.infer<typeof licenceRestrictionSchema>;

/**
 * Whether a restriction holds on a day: a cancellation from its first day on, a suspension from its first to its last day. One that
 * starts later is recorded but does not hold yet.
 */
export const restrictionHolds = (r: Pick<LicenceRestriction, 'kind' | 'startsOn' | 'endsOn'>, today: string): boolean =>
    r.startsOn <= today && (r.kind === 'cancellation' || (r.endsOn !== null && today <= r.endsOn));
