/**
 * Encumbrances on a vehicle (task 1.4a; ethiopia-context.md §2): a bank loan (the bank keeps the libre until its release
 * letter), a court order, a revenue or customs hold. The holder is an external body, a `parties.organisations` row; the office
 * that records it acts for the holder, on the holder's letter, and the same office records its release on the holder's release
 * letter, which a second person confirms. While one is open or waiting for that confirmation it blocks the services it
 * conflicts with: a service names `vehicles.checkEncumbrances:<conflict>` among its effects.
 */
import { santimTextSchema } from '@itrms/schemas';
import { z } from 'zod';

export const ENCUMBRANCE_KINDS = [
    'bank_loan',
    'court_order',
    'revenue_hold',
    'customs_hold',
    'insurance_hold'
] as const;
export const ENCUMBRANCE_STATUSES = ['open', 'release_pending', 'released'] as const;
/** The services an encumbrance can stand in the way of; the argument of the check effect. */
export const ENCUMBRANCE_CONFLICTS = ['ownership-transfer', 'zone-transfer-out', 'replacement'] as const;

export type EncumbranceKind = (typeof ENCUMBRANCE_KINDS)[number];
export type EncumbranceStatus = (typeof ENCUMBRANCE_STATUSES)[number];
export type EncumbranceConflict = (typeof ENCUMBRANCE_CONFLICTS)[number];

/** Which kinds of encumbrance block each conflicting service, per installation or region. */
export const ENCUMBRANCE_BLOCKS_SETTING = 'vehicles.encumbrance_blocks';
export const DEFAULT_ENCUMBRANCE_BLOCKS: Record<EncumbranceConflict, EncumbranceKind[]> = {
    'ownership-transfer': [...ENCUMBRANCE_KINDS],
    'zone-transfer-out': [...ENCUMBRANCE_KINDS],
    // a new plate or booklet changes nothing a tax or customs hold protects
    replacement: ['bank_loan', 'court_order']
};
/** The floor no region may lower: a court order always stops a change of owner or of zone. */
const COURT_FLOOR = ['ownership-transfer', 'zone-transfer-out'] as const;
export const encumbranceBlocksSchema = z
    .record(z.enum(ENCUMBRANCE_CONFLICTS), z.array(z.enum(ENCUMBRANCE_KINDS)).max(10))
    .refine((blocks) => COURT_FLOOR.every((conflict) => blocks[conflict]?.includes('court_order') === true), {
        message: 'a court order must stay among the kinds that block an ownership transfer and a zone transfer out'
    });

/** The effect a service names to refuse itself while the vehicle is encumbered: `vehicles.checkEncumbrances:<conflict>`. */
export const ENCUMBRANCE_EFFECTS = { checkEncumbrances: 'vehicles.checkEncumbrances' } as const;

const isoDate = z.iso.date();
const unitRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });
const reference = z.string().trim().min(1).max(60);
const note = z.string().trim().min(1).max(500);

/** `POST /encumbrances`: the holder's letter, recorded by the acting office. */
export const encumbranceRecordSchema = z.strictObject({
    vehicleId: z.uuid(),
    kind: z.enum(ENCUMBRANCE_KINDS),
    holderOrganisationId: z.uuid(),
    letterReference: reference,
    letterDate: isoDate,
    /** the amount secured, in santim as text, when the letter gives one */
    amountSantim: santimTextSchema.refine((v) => v !== '0', 'is not above zero').optional(),
    note: note.optional(),
    letterFileId: z.uuid().optional()
});
export type EncumbranceRecord = z.infer<typeof encumbranceRecordSchema>;

/** `POST /encumbrances/:id/release-request`: the holder's release letter. */
export const releaseRequestSchema = z.strictObject({
    releaseReference: reference,
    releaseDate: isoDate,
    releaseFileId: z.uuid().optional(),
    note: note.optional()
});
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

/** `POST /encumbrances/:id/release-refusal`: the second person does not confirm the release. */
export const releaseRefusalSchema = z.strictObject({ reason: z.string().trim().min(10).max(500) });
export type ReleaseRefusal = z.infer<typeof releaseRefusalSchema>;

/** `GET /encumbrances?vehicleId=&status=&after=&limit=` */
export const encumbranceListQuerySchema = z.strictObject({
    vehicleId: z.uuid().optional(),
    status: z.enum(ENCUMBRANCE_STATUSES).optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type EncumbranceListQuery = z.infer<typeof encumbranceListQuerySchema>;

const holderRef = z.object({ id: z.uuid(), name: z.record(z.string(), z.string()) });
const personRef = z.object({ id: z.uuid(), name: z.string() });

export const encumbranceSchema = z.object({
    id: z.uuid(),
    version: z.number().int(),
    vehicleId: z.uuid(),
    kind: z.enum(ENCUMBRANCE_KINDS),
    status: z.enum(ENCUMBRANCE_STATUSES),
    holder: holderRef,
    recordedUnit: unitRefSchema,
    letterReference: z.string(),
    letterDate: isoDate,
    amountSantim: santimTextSchema.nullable(),
    note: z.string().nullable(),
    letterFile: z.object({ id: z.uuid() }).nullable(),
    recordedAt: z.string(),
    releaseReference: z.string().nullable(),
    releaseDate: isoDate.nullable(),
    releaseFile: z.object({ id: z.uuid() }).nullable(),
    releaseNote: z.string().nullable(),
    releaseRequestedBy: personRef.nullable(),
    releaseRequestedAt: z.string().nullable(),
    releasedBy: personRef.nullable(),
    releasedAt: z.string().nullable(),
    releaseRefusalReason: z.string().nullable()
});
export type Encumbrance = z.infer<typeof encumbranceSchema>;

export const encumbranceListSchema = z.object({
    items: z.array(encumbranceSchema),
    nextCursor: z.string().nullable()
});

/** What a vehicle's summary shows of an encumbrance that is not released. */
export const openEncumbranceSchema = z.object({
    id: z.uuid(),
    kind: z.enum(ENCUMBRANCE_KINDS),
    status: z.enum(ENCUMBRANCE_STATUSES),
    holder: holderRef,
    letterDate: isoDate,
    recordedUnit: unitRefSchema
});
export type OpenEncumbrance = z.infer<typeof openEncumbranceSchema>;
