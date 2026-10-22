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

// ---- files (task 0.15, architecture §14) ----

/** The kinds of file accepted: scans and photos of documents. */
export const ACCEPTED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
/** Up to this size a file goes in one presigned POST; above it, in parts of PART_SIZE (the last one smaller). */
export const SINGLE_UPLOAD_LIMIT = 16 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;

export const fileUploadRequestSchema = z.strictObject({
    /** shown and offered on download; never part of a storage key */
    filename: z
        .string()
        .trim()
        .min(1)
        .max(200)
        // no control character and no path separator: a name, never a path
        .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 0x20 || c === '/' || c === '\\'), 'is not a file name'),
    contentType: z.enum(ACCEPTED_FILE_TYPES),
    size: z.number().int().min(1).max(MAX_FILE_SIZE),
    /** SHA-256 of the content, hex: the browser computes it, the server checks it on confirmation */
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected a hex SHA-256'),
    /** the kind of document (`id_card`, `medical_certificate` …) */
    documentType: z
        .string()
        .regex(/^[a-z][a-z0-9_]{1,40}$/)
        .optional()
});
export type FileUploadRequest = z.infer<typeof fileUploadRequestSchema>;

export const fileSchema = z.object({
    id: z.uuid(),
    status: z.enum(['pending', 'stored', 'rejected', 'expired']),
    filename: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    sha256: z.string(),
    documentType: z.string().nullable(),
    linked: z.boolean(),
    createdAt: z.string(),
    confirmedAt: z.string().nullable()
});
export type StoredFile = z.infer<typeof fileSchema>;

/** Where the browser sends the bytes: one POST with the policy's fields, or one PUT per part. */
export const uploadTicketSchema = z.object({
    file: fileSchema,
    upload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('post'), url: z.string(), fields: z.record(z.string(), z.string()) }),
        z.object({
            kind: z.literal('parts'),
            parts: z.array(z.object({ partNumber: z.number().int(), size: z.number().int(), url: z.string() }))
        })
    ]),
    expiresAt: z.string()
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const fileConfirmSchema = z.strictObject({
    /** a multipart upload's parts, with the ETag each PUT answered */
    parts: z
        .array(z.strictObject({ partNumber: z.number().int().min(1).max(100), etag: z.string().min(1).max(200) }))
        .max(100)
        .optional()
});

export const fileDownloadSchema = z.object({ url: z.string(), expiresAt: z.string() });
