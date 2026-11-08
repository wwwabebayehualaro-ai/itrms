/** Shared by the register's services. */
import { ConflictError, ForbiddenError, ValidationError } from '@itrms/kernel/errors';

export { unitRefs, withinScope, type UnitRef } from '@itrms/kernel/org';

/** The unit the caller acts for (a request without one cannot write to the register). */
export function required(value: string | undefined): string {
    if (!value) throw new ForbiddenError({ detailKey: 'vehicles.errors.choose_office' });
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

/** Runs a write, answering the named unique constraints with 409 `duplicate_reference` and the given words. */
export async function guardUnique<T>(write: () => Promise<T>, constraints: Record<string, string>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        for (const [constraint, detailKey] of Object.entries(constraints))
            if (isUniqueViolation(error, constraint))
                throw new ConflictError('duplicate_reference', { detailKey, cause: error });
        throw error;
    }
}

/** A value the rules refuse, as a field error. */
export const fieldError = (path: string, code: string, message: string) =>
    new ValidationError('validation_failed', { errors: [{ path, code, message }] });

/** The names of a holder in both languages: the person's own names, or the organisation's. */
export const joinName = (name: { given: string; father: string; grandfather?: string | undefined } | null): string =>
    name ? [name.given, name.father, name.grandfather].filter(Boolean).join(' ') : '';

/** Today in the register's time zone, as a Gregorian date (`YYYY-MM-DD`). */
export const today = (): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());

/** A date a command records cannot be in the future. */
export function notFuture(path: string, date: string): void {
    if (date > today()) throw fieldError(path, 'in_future', 'is in the future');
}
