/**
 * The stock of national plates (task 1.2a; ethiopia-context.md §2, Directive 1050/2025): the plates the federal source
 * delivers, held by a unit and handed down the tree to the offices that issue them. Each plate has one status and moves
 * through the machine below; the database checks the same transitions (migration 0066), so no writer can skip a step.
 * A plate from stock is assigned to a vehicle once in its life: retired, void and lost are final.
 */
import { z } from 'zod';

import { foldPlate, parsePlate } from './plate';

export const PLATE_STATUSES = ['in_stock', 'allocated', 'reserved', 'assigned', 'retired', 'void', 'lost'] as const;
export type PlateStatus = (typeof PLATE_STATUSES)[number];
export const FINAL_PLATE_STATUSES: readonly PlateStatus[] = ['retired', 'void', 'lost'];

export const PLATE_EVENTS = [
    'receive',
    'allocate',
    'accept',
    'recall',
    'reserve',
    'release',
    'assign',
    'retire',
    'lose',
    'void',
    'write_off_lost'
] as const;
export type PlateEvent = (typeof PLATE_EVENTS)[number];

export const MOVEMENT_KINDS = [
    'receive',
    'allocate',
    'accept',
    'recall',
    'assign',
    'retire',
    'lose',
    'write_off'
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const PLATE_END_REASONS = [
    'exchanged',
    'retired',
    'transferred',
    'lost',
    'stolen',
    'damaged',
    'misprinted',
    'other'
] as const;
export type PlateEndReason = (typeof PLATE_END_REASONS)[number];
export const WRITE_OFF_REASONS = ['damaged', 'misprinted', 'lost', 'stolen', 'other'] as const;

/** The machine: from which statuses each event goes, and to which. `receive` creates the plate. */
export const PLATE_TRANSITIONS: Record<
    Exclude<PlateEvent, 'receive'>,
    { from: readonly PlateStatus[]; to: PlateStatus }
> = {
    allocate: { from: ['in_stock'], to: 'allocated' },
    accept: { from: ['allocated'], to: 'in_stock' },
    recall: { from: ['in_stock', 'allocated'], to: 'in_stock' },
    reserve: { from: ['in_stock'], to: 'reserved' },
    release: { from: ['reserved'], to: 'in_stock' },
    assign: { from: ['in_stock', 'reserved'], to: 'assigned' },
    retire: { from: ['assigned'], to: 'retired' },
    lose: { from: ['assigned'], to: 'lost' },
    void: { from: ['in_stock', 'allocated'], to: 'void' },
    write_off_lost: { from: ['in_stock', 'allocated'], to: 'lost' }
};

/** The status a plate has after `event`, or null when the event cannot happen to a plate in `from`. */
export function nextPlateStatus(from: PlateStatus, event: Exclude<PlateEvent, 'receive'>): PlateStatus | null {
    const rule = PLATE_TRANSITIONS[event];
    return rule.from.includes(from) ? rule.to : null;
}

/** The most plates one command takes (a federal delivery is counted in hundreds; a series has 10 000). */
export const MAX_PLATES = 10_000;
export const MAX_PLATE_KEYS = 1_000;

const series = z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'three Latin letters'));
const serial = z.number().int().min(0).max(9999);

/** A national plate typed in Latin or Ethiopic letters, as its key (`ETHABC1234`). */
const nationalKey = z
    .string()
    .trim()
    .min(3)
    .max(40)
    .transform((text, ctx) => {
        const parsed = parsePlate(text, []);
        if (parsed?.format !== 'national') {
            ctx.addIssue({ code: 'custom', message: 'not a national plate', params: { code: 'invalid_plate' } });
            return z.NEVER;
        }
        return parsed.key;
    });

/** Which plates a command takes: a run of one series (`ABC` 0001-0500), or a list of plates. */
export const plateSelectionSchema = z.union([
    z
        .strictObject({ series, from: serial, to: serial })
        .refine((r) => r.to >= r.from, { path: ['to'], message: 'is before the first plate' })
        .refine((r) => r.to - r.from + 1 <= MAX_PLATES, { path: ['to'], message: `at most ${MAX_PLATES} plates` }),
    z.strictObject({
        keys: z
            .array(nationalKey)
            .min(1)
            .max(MAX_PLATE_KEYS)
            .refine((keys) => new Set(keys).size === keys.length, 'a plate is listed twice')
    })
]);
export type PlateSelection = z.infer<typeof plateSelectionSchema>;

/** The keys a selection names, in series and serial order. */
export function selectionKeys(selection: PlateSelection): string[] {
    if ('keys' in selection) return [...selection.keys].sort();
    const out: string[] = [];
    for (let n = selection.from; n <= selection.to; n += 1)
        out.push(`ETH${selection.series}${String(n).padStart(4, '0')}`);
    return out;
}

/** A national plate key's parts. */
export function plateParts(key: string): { series: string; serial: number } {
    const folded = foldPlate(key);
    return { series: folded.slice(3, 6), serial: Number(folded.slice(6)) };
}

const isoDate = z.iso.date();
const note = z.string().trim().min(1).max(500).optional();

/** `POST /plate-stock/batches`: a delivery from the federal source, received by the acting unit. */
export const plateBatchReceiveSchema = z.strictObject({
    /** the federal dispatch or delivery-note number */
    reference: z.string().trim().min(1).max(60),
    receivedOn: isoDate,
    plates: plateSelectionSchema,
    note
});
export type PlateBatchReceive = z.infer<typeof plateBatchReceiveSchema>;

/** `POST /plate-stock/allocations`: plates handed to a unit directly below. */
export const plateAllocationSchema = z.strictObject({ toUnitId: z.uuid(), plates: plateSelectionSchema, note });
export type PlateAllocation = z.infer<typeof plateAllocationSchema>;

/** `POST /plate-stock/movements/:id/acceptance`: the unit below takes the plates it was sent, all or all but some. */
export const plateAcceptanceSchema = z.strictObject({
    exceptKeys: z.array(nationalKey).max(MAX_PLATE_KEYS).optional(),
    note
});
export type PlateAcceptance = z.infer<typeof plateAcceptanceSchema>;

/** `POST /plate-stock/recalls`: plates taken back from a unit directly below. */
export const plateRecallSchema = z.strictObject({
    fromUnitId: z.uuid(),
    plates: plateSelectionSchema,
    reason: z.string().trim().min(10).max(500)
});
export type PlateRecall = z.infer<typeof plateRecallSchema>;

/** `POST /plate-stock/write-offs`: plates in stock that will never be issued. */
export const plateWriteOffSchema = z.strictObject({
    status: z.enum(['void', 'lost']),
    plates: plateSelectionSchema,
    endReason: z.enum(WRITE_OFF_REASONS),
    reason: z.string().trim().min(10).max(500)
});
export type PlateWriteOff = z.infer<typeof plateWriteOffSchema>;

/** `GET /plate-stock/plates` */
export const plateListQuerySchema = z.strictObject({
    q: z.string().trim().min(3).max(40).optional(),
    status: z.enum(PLATE_STATUSES).optional(),
    holderUnitId: z.uuid().optional(),
    /** the plates reserved for one case */
    caseId: z.uuid().optional(),
    series: z.string().trim().length(3).optional(),
    after: z.string().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type PlateListQuery = z.infer<typeof plateListQuerySchema>;

/** `GET /plate-stock/movements` */
export const movementListQuerySchema = z.strictObject({
    unitId: z.uuid().optional(),
    kind: z.enum(MOVEMENT_KINDS).optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

const unitRef = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const stockPlateSchema = z.object({
    id: z.uuid(),
    key: z.string(),
    text: z.string(),
    status: z.enum(PLATE_STATUSES),
    statusOn: isoDate,
    holder: unitRef,
    vehicleId: z.uuid().nullable(),
    caseId: z.uuid().nullable(),
    endReason: z.enum(PLATE_END_REASONS).nullable()
});
export type StockPlate = z.infer<typeof stockPlateSchema>;

export const plateMovementSchema = z.object({
    id: z.uuid(),
    kind: z.enum(MOVEMENT_KINDS),
    unit: unitRef,
    fromUnit: unitRef.nullable(),
    toUnit: unitRef.nullable(),
    batchId: z.uuid().nullable(),
    ofMovementId: z.uuid().nullable(),
    quantity: z.number().int(),
    firstKey: z.string(),
    lastKey: z.string(),
    occurredOn: isoDate,
    reason: z.string().nullable(),
    note: z.string().nullable(),
    /** an allocation: how many of its plates are still waiting to be accepted */
    awaiting: z.number().int().nullable()
});
export type PlateMovement = z.infer<typeof plateMovementSchema>;

export const plateBatchSchema = z.object({
    id: z.uuid(),
    reference: z.string(),
    receivedOn: isoDate,
    receivingUnit: unitRef,
    quantity: z.number().int(),
    firstKey: z.string(),
    lastKey: z.string(),
    note: z.string().nullable()
});
export type PlateBatch = z.infer<typeof plateBatchSchema>;

const counts = {
    /** plates this unit took in: received from the federal source, or accepted from above, less those recalled */
    received: z.number().int(),
    inStock: z.number().int(),
    /** sent to this unit and not yet accepted */
    inTransit: z.number().int(),
    reserved: z.number().int(),
    assigned: z.number().int(),
    retired: z.number().int(),
    void: z.number().int(),
    lost: z.number().int(),
    /** held below this unit, whatever their status */
    allocatedDown: z.number().int()
};

/** A unit's plate counts, and whether its ledger agrees with what it holds. */
export const stockSummaryRowSchema = z.object({
    unit: unitRef,
    /** the unit's type holds plate stock (the capability), so plates can be allocated to it */
    holdsPlateStock: z.boolean(),
    ...counts,
    ledger: z.object({ received: z.number().int(), allocatedDown: z.number().int() }),
    reconciled: z.boolean()
});
export type StockSummaryRow = z.infer<typeof stockSummaryRowSchema>;
export const stockSummarySchema = z.object({ unit: stockSummaryRowSchema, children: z.array(stockSummaryRowSchema) });
export type StockSummary = z.infer<typeof stockSummarySchema>;
