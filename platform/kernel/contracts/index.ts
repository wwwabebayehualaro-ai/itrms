// Public entry of @itrms/kernel (code-structure.md §4): the payloads of the events the kernel emits.
import { DOCUMENT_TYPES, INSTALLABLE_LANGUAGES } from '@itrms/schemas';
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

/**
 * The value schemas of the kernel's settings (ADR-0026; declared in its manifest): the installation's languages, and the
 * look of the screens, which a region sets for its offices and each person may choose for themselves.
 */
export const UI_THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
export const UI_DENSITIES = ['comfortable', 'compact'] as const;
export const KERNEL_SETTINGS = {
    'i18n.languages': z
        .array(z.enum(INSTALLABLE_LANGUAGES))
        .min(2)
        .max(INSTALLABLE_LANGUAGES.length)
        .refine((l) => new Set(l).size === l.length, 'a language is listed twice')
        .refine((l) => l.includes('am') && l.includes('en'), 'Amharic and English are always on'),
    'ui.theme': z.enum(UI_THEMES),
    'ui.density': z.enum(UI_DENSITIES)
} as const;

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

/** A character a file name never holds: a control, a path separator, or a mark that reorders or hides text. */
const unsafeInName = (c: string) => {
    const code = c.charCodeAt(0);
    return (
        code < 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x200b ||
        code === 0x200e ||
        code === 0x200f ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069) ||
        c === '/' ||
        c === '\\'
    );
};

/** The kinds of file accepted: scans and photos of documents. */
export const ACCEPTED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
/** What the server itself makes and stores (task 0.16e): exports, and the documents of task 0.23. Never uploaded. */
export const GENERATED_FILE_TYPES = {
    'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/pdf': 'pdf'
} as const;
export type GeneratedFileType = keyof typeof GENERATED_FILE_TYPES;
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
        // a name, never a path; no control character, and no direction or invisible mark that disguises an extension
        .refine((v) => ![...v].some(unsafeInName), 'is not a file name'),
    contentType: z.enum(ACCEPTED_FILE_TYPES),
    size: z.number().int().min(1).max(MAX_FILE_SIZE),
    /** SHA-256 of the content, hex: the browser computes it, the server checks it on confirmation */
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected a hex SHA-256'),
    /** the kind of document (`id_card`, `medical_certificate` …) */
    documentType: z.enum(DOCUMENT_TYPES).optional()
});
export type FileUploadRequest = z.infer<typeof fileUploadRequestSchema>;

export const fileSchema = z.object({
    id: z.uuid(),
    status: z.enum(['pending', 'checking', 'stored', 'rejected', 'expired']),
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
