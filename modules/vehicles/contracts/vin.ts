/**
 * The chassis number (VIN) of a vehicle: its normal form for search, and the ISO 3779 check digit. The check digit binds
 * only the vehicles whose manufacturer's country makes it law (North America, WMI starting 1 to 5, and China, L): elsewhere
 * a mismatch is a warning on the record, because other makers do not follow it. A chassis number that is not an ISO 3779
 * VIN (not 17 characters, or built before 1981) is entered as `other` and kept as typed, in its search form.
 */

export const CHASSIS_KINDS = ['iso3779', 'other'] as const;
export type ChassisKind = (typeof CHASSIS_KINDS)[number];
export const VIN_CHECKS = ['ok', 'mismatch', 'not_applicable'] as const;
export type VinCheck = (typeof VIN_CHECKS)[number];

/** A model year before this cannot carry an ISO 3779 VIN. */
export const FIRST_VIN_YEAR = 1981;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const TRANSLITERATION: Record<string, number> = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    F: 6,
    G: 7,
    H: 8,
    J: 1,
    K: 2,
    L: 3,
    M: 4,
    N: 5,
    P: 7,
    R: 9,
    S: 2,
    T: 3,
    U: 4,
    V: 5,
    W: 6,
    X: 7,
    Y: 8,
    Z: 9
};

/**
 * The form a chassis or engine number is searched and kept unique in: upper case, letters and digits only, and the letters
 * a person mistakes for digits written as digits (I as 1, O and Q as 0; an ISO 3779 VIN has none of the three).
 */
export function vehicleSearchKey(value: string): string {
    return value
        .normalize('NFC')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .replace(/I/g, '1')
        .replace(/[OQ]/g, '0');
}

/** What a person typed into a search box, made into the two keys the search function takes. */
export function searchKeys(q: string): { key: string; plateKey: string } {
    // the federal vehicle id may hold hyphens; everything else is letters and digits
    const key = q
        .normalize('NFC')
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
    return { key, plateKey: key.replace(/-/g, '') };
}

/** The ISO 3779 check digit of a 17-character VIN (the ninth), as it should be written. */
export function vinCheckDigit(vin: string): string | null {
    let sum = 0;
    for (let i = 0; i < 17; i += 1) {
        const c = vin[i] ?? '';
        const value = /[0-9]/.test(c) ? Number(c) : TRANSLITERATION[c];
        if (value === undefined) return null;
        sum += value * (WEIGHTS[i] ?? 0);
    }
    const remainder = sum % 11;
    return remainder === 10 ? 'X' : String(remainder);
}

/** Whether the WMI's first character is one of the countries where the check digit is law (US/Canada/Mexico, China). */
const checkDigitBinds = (vin: string): boolean => /^[1-5L]/.test(vin);

export type VinProblem =
    'invalid_chars' | 'invalid_length' | 'check_digit' | 'needs_other_kind' | 'invalid_other' | 'iso_vin_as_other';

export type ParsedVin =
    | { ok: true; chassisNumber: string; chassisKind: ChassisKind; vinKey: string; vinCheck: VinCheck }
    | { ok: false; code: 'invalid_vin'; problem: VinProblem };

/**
 * A typed chassis number. `chassisKind` is what the officer declared (none: an ISO VIN is expected); `modelYear` is the
 * vehicle's, since a vehicle built before 1981 has no ISO VIN. `acceptMismatch` lets an officer who has checked the plate on
 * the chassis record a binding check digit that does not match (it is kept as a `mismatch`, not refused).
 */
export function parseVin(
    raw: string,
    options: { chassisKind?: ChassisKind; modelYear?: number; acceptMismatch?: boolean } = {}
): ParsedVin {
    const chassisNumber = raw.normalize('NFC').toUpperCase().replace(/[\s-]/g, '');
    if (options.chassisKind === 'other') {
        if (!/^[A-Z0-9./]{4,30}$/.test(chassisNumber) || vehicleSearchKey(chassisNumber).length < 4)
            return { ok: false, code: 'invalid_vin', problem: 'invalid_other' };
        // a VIN-shaped number of a vehicle that can carry one is an ISO 3779 VIN: its uniqueness and check digit apply
        if ((options.modelYear ?? FIRST_VIN_YEAR) >= FIRST_VIN_YEAR && VIN_PATTERN.test(chassisNumber))
            return { ok: false, code: 'invalid_vin', problem: 'iso_vin_as_other' };
        return {
            ok: true,
            chassisNumber,
            chassisKind: 'other',
            vinKey: vehicleSearchKey(chassisNumber),
            vinCheck: 'not_applicable'
        };
    }
    if ((options.modelYear ?? FIRST_VIN_YEAR) < FIRST_VIN_YEAR)
        return { ok: false, code: 'invalid_vin', problem: 'needs_other_kind' };
    if (chassisNumber.length !== 17) return { ok: false, code: 'invalid_vin', problem: 'invalid_length' };
    if (!VIN_PATTERN.test(chassisNumber)) return { ok: false, code: 'invalid_vin', problem: 'invalid_chars' };
    const ok = vinCheckDigit(chassisNumber) === chassisNumber[8];
    if (!ok && checkDigitBinds(chassisNumber) && !options.acceptMismatch)
        return { ok: false, code: 'invalid_vin', problem: 'check_digit' };
    return {
        ok: true,
        chassisNumber,
        chassisKind: 'iso3779',
        vinKey: chassisNumber,
        vinCheck: ok ? 'ok' : 'mismatch'
    };
}
