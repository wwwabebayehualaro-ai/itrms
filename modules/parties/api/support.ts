/**
 * Shared by the register's services. The units a register shows (handling unit, address) are any unit of the caller's
 * region (unitRefs, from the kernel).
 */
import { ForbiddenError } from '@itrms/kernel/errors';

export { unitRefs, withinScope, type UnitRef } from '@itrms/kernel/org';

/** The unit the caller acts for (a request without one cannot write to a register). */
export function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detail: 'Choose the office you act for.' });
    return value;
}

/** A unique constraint refused the write (the database is the last word on duplicates written at the same moment). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
        const { code, constraint: name } = e as { code?: string; constraint?: string };
        if (code === '23505' && name === constraint) return true;
    }
    return false;
}
