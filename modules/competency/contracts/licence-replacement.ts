/**
 * The replacement of a driver licence's card (DVC-19, Proclamation 1074/2018 Art. 18, ADR-0064 §5, task 1.6e): lost, stolen, damaged
 * or outdated, on the fee. A lost or stolen card needs the police letter; a damaged or outdated one is handed in (Art. 18: an old
 * licence found again is returned for cancellation). The licence keeps its number and its term: only its card changes. The old card
 * document is superseded (its QR says so), a new card goes to print and a temporary permit stands meanwhile (task 1.6d).
 */
export const LICENCE_REPLACEMENT_EFFECTS = {
    checkLicenceReplacement: 'competency.checkLicenceReplacement',
    replaceLicenceCard: 'competency.replaceLicenceCard'
} as const;

/** The service's code in the catalogue (ADR-0064 §5). */
export const LICENCE_REPLACEMENT_SERVICE = 'DVC-19';

export const LICENCE_REPLACEMENT_REASONS = ['lost', 'stolen', 'damaged', 'outdated'] as const;
export type LicenceReplacementReason = (typeof LICENCE_REPLACEMENT_REASONS)[number];

/** The reasons whose card is gone: the police letter stands for it. */
export const CARD_GONE: readonly LicenceReplacementReason[] = ['lost', 'stolen'];

/** The request's facts an effect reads, by contract path (see licence-replacement.effects.ts). */
export type LicenceReplacementInput = {
    licence: string;
    reason: string;
    /** the police letter's scan (lost, stolen) */
    policeReport?: unknown[];
    /** the old card handed in at the desk (damaged, outdated) */
    oldCardHandedIn?: boolean;
};
