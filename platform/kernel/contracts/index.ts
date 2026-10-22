// Public entry of @itrms/kernel (code-structure.md §4): the payloads of the events the kernel emits.
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

export const KERNEL_EVENTS = {
    'org-unit.changed.v1': orgUnitChangedV1,
    'role-assignment.changed.v1': roleAssignmentChangedV1
} as const;
