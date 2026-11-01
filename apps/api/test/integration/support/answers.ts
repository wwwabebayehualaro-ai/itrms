/**
 * Stored answers without their rows' ids (ADR-0040: the server gives every row one), for the checks where the ids are not
 * what is checked.
 */
export const noIds = (value: unknown): unknown =>
    Array.isArray(value)
        ? value.map(noIds)
        : value && typeof value === 'object'
          ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>)
                    .filter(([k]) => k !== '_id')
                    .map(([k, v]) => [k, noIds(v)])
            )
          : value;
