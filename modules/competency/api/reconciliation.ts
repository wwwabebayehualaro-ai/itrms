/**
 * The arithmetic of the reconciliation report (task 1.13h, ADR-0054 §4). No database: the service gathers the counts, these say what
 * they mean.
 */
import { PAPER_PLATE_CODES, type PaperPlateCode } from '../contracts';

/** The group an old regional plate's use code shelves a paper file in; a national or special plate, none, or another code is `other`. */
export function plateCodeOf(legacyUseCode: number | null | undefined): PaperPlateCode {
    if (legacyUseCode === null || legacyUseCode === undefined) return 'other';
    const code = String(legacyUseCode);
    return PAPER_PLATE_CODES.find((c) => c === code && c !== 'other') ?? 'other';
}

/** Paper files not yet on the register: null without a paper count, never below zero (more verified than counted is not a debt). */
export function missingOf(paper: number | null, verified: number): number | null {
    return paper === null ? null : Math.max(paper - verified, 0);
}

export interface CodeCount {
    paper: number | null;
    verified: number;
}

export interface Sums {
    verified: number;
    paper: number | null;
    missing: number | null;
    share: number | null;
}

/**
 * An office's (or the whole report's) sums over its codes. `paper` and `missing` add the codes that have a paper count; the share is
 * the verified vehicles of those codes over their paper, so a code nobody counted does not inflate it. `verified` is every code's.
 */
export function sumsOf(codes: readonly CodeCount[]): Sums {
    const counted = codes.filter((c): c is { paper: number; verified: number } => c.paper !== null);
    const paper = counted.length === 0 ? null : counted.reduce((n, c) => n + c.paper, 0);
    const verifiedOfCounted = counted.reduce((n, c) => n + c.verified, 0);
    return {
        verified: codes.reduce((n, c) => n + c.verified, 0),
        paper,
        missing: counted.length === 0 ? null : counted.reduce((n, c) => n + (missingOf(c.paper, c.verified) ?? 0), 0),
        share: paper === null || paper === 0 ? null : verifiedOfCounted / paper
    };
}
