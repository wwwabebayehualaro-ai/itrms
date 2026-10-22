// Public entry of @itrms/kernel (code-structure.md §4): the payloads of the events the kernel emits.
import { INSTALLABLE_LANGUAGES } from '@itrms/schemas';
import { z } from 'zod';

/** A unit was created, renamed, moved or deactivated (the identity provider's groups follow). */
export const orgUnitChangedV1 = z.strictObject({
    unitId: z.uuid(),
    change: z.enum(['created', 'renamed', 'moved', 'deactivated'])
});

/** A role was granted or revoked (the identity provider's memberships follow). */
export const roleAssignmentChangedV1 = z.strictObject({
    assignmentId: z.uuid(),
    userId: z.uuid(),
    unitId: z.uuid(),
    change: z.enum(['granted', 'revoked'])
});

/** A person's own display preferences (task 0.13): kept on the server so they follow the person between PCs. */
export const userPreferencesSchema = z.strictObject({
    language: z.enum(INSTALLABLE_LANGUAGES).optional(),
    calendar: z.enum(['ethiopian', 'gregorian']).optional(),
    /** pinned menu items, by key */
    favourites: z.array(z.string().max(120)).max(50).optional(),
    /** pages opened, the latest first */
    recents: z
        .array(z.strictObject({ key: z.string().max(120), at: z.number().int().nonnegative() }))
        .max(20)
        .optional()
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const KERNEL_EVENTS = {
    'org-unit.changed.v1': orgUnitChangedV1,
    'role-assignment.changed.v1': roleAssignmentChangedV1
} as const;
