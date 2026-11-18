/**
 * The replacement of a lost, stolen or damaged libre, bolo sticker or plate (task 1.5, DVC-06, ADR-0062). The register is the
 * vehicles slice's; these are the competency work process's steps over it. Part 1 does the libre; the bolo sticker (1.5b) and the
 * plate (1.5c) have their effect keys here already, so the service's fee rule and its table name all three.
 */

export const REPLACEMENT_EFFECTS = {
    checkReplacement: 'competency.checkReplacement',
    checkReplacementNotice: 'competency.checkReplacementNotice',
    replaceLibre: 'competency.replaceLibre',
    replaceBoloSticker: 'competency.replaceBoloSticker',
    replacePlate: 'competency.replacePlate'
} as const;

/** The service's code in the catalogue: the bureau's own replacement service. */
export const REPLACEMENT_SERVICE = 'DVC-06';

export const REPLACEMENT_ITEMS = ['libre', 'bolo', 'plate'] as const;
export type ReplacementItem = (typeof REPLACEMENT_ITEMS)[number];

export const REPLACEMENT_REASONS = ['lost', 'stolen', 'damaged'] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

/**
 * How many calendar days a lost or stolen libre waits after its newspaper notice before it is replaced (the zone's written
 * answers: 15; a region's setting, sensitive).
 */
/**
 * A bolo whose last day is this near is not given a new sticker: the owner takes the annual inspection instead (placeholder, to
 * confirm with the zone), so a case does not wait out the bolo it replaces.
 */
export const BOLO_REPLACEMENT_MIN_DAYS = 7;

export const LIBRE_NOTICE_DAYS_SETTING = 'competency.libre_notice_days';
export const DEFAULT_LIBRE_NOTICE_DAYS = 15;
