/**
 * The Ethiopian fiscal year (EFY), Hamle 1 to Sene 30 (architecture.md §13), named by the Ethiopian year it ends in:
 * Hamle 1, 2018 (8 July 2026) opens EFY 2019. Quarters: Hamle–Meskerem (Pagume with them), Tikimt–Tahsas, Tir–Megabit,
 * Miyazya–Sene.
 */
import { type EthiopianDate } from './convert';

const HAMLE = 11;

export const fiscalYearOf = (date: EthiopianDate): number => (date.month >= HAMLE ? date.year + 1 : date.year);

/** 1–4. */
export function fiscalQuarterOf(date: EthiopianDate): number {
    // months counted from Hamle: Hamle 0, Nehase 1, Pagume 2, Meskerem 3, Tikimt 4 …, Sene 12
    const fromHamle = (date.month - HAMLE + 13) % 13;
    if (fromHamle <= 3) return 1;
    return Math.ceil((fromHamle - 3) / 3) + 1;
}

/** The first and last day of a fiscal year. */
export function fiscalYearRange(efy: number): { start: EthiopianDate; end: EthiopianDate } {
    return { start: { year: efy - 1, month: HAMLE, day: 1 }, end: { year: efy, month: 10, day: 30 } };
}
