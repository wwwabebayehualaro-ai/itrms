/**
 * Controlled stationery (task 1.12a; architecture.md §9, ADR-0050): pre-printed, serial-numbered forms an office must account
 * for one by one: libre booklets from the ministry, licence card blanks, bolo stickers and receipt pad leaves. A unit that
 * holds stationery (the `holds_stationery` capability) receives a delivery in serial ranges, hands items to a unit directly
 * below it, which accepts them, and takes them back (a recall). An item is used once (a licence printed on it, a booklet
 * issued, a sticker stuck), spoiled with a reason (a misprint is kept, never reissued), or written off (void, missing).
 * At the office's closing the items it counts are set against those it should hold, and a missing serial is flagged.
 *
 * The database checks the same transitions (migration 0068), so no writer can skip a step.
 */
import { z } from 'zod';

export const STATIONERY_KINDS = ['libre_booklet', 'licence_blank', 'bolo_sticker', 'receipt_leaf'] as const;
export type StationeryKind = (typeof STATIONERY_KINDS)[number];

export const STATIONERY_STATUSES = ['in_stock', 'allocated', 'used', 'spoiled', 'void', 'missing'] as const;
export type StationeryStatus = (typeof STATIONERY_STATUSES)[number];
export const FINAL_STATIONERY_STATUSES: readonly StationeryStatus[] = ['used', 'spoiled', 'void', 'missing'];

/**
 * Where a delivery comes from: the zone buys its printed forms from the regional bureau (the zone's letters, 2016 E.C.),
 * and its receipt vouchers (form መ/ሂ/7) are the regional finance bureau's.
 */
export const STATIONERY_SOURCES = ['regional_bureau', 'finance_bureau', 'ministry', 'printer', 'other'] as const;
export type StationerySource = (typeof STATIONERY_SOURCES)[number];

/** A variant: the plate code or category a form is printed for (bolo stickers per code: `1`, `2` … `police`, `government`). */
const variant = z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,20}$/, 'a short code');

export const STATIONERY_EVENTS = ['receive', 'allocate', 'accept', 'recall', 'use', 'spoil', 'void', 'lose'] as const;
export type StationeryEvent = (typeof STATIONERY_EVENTS)[number];

/** The ledger: one row per command, however many items it moved. */
export const STATIONERY_MOVEMENT_KINDS = [
    'receive',
    'allocate',
    'accept',
    'recall',
    'use',
    'spoil',
    'write_off'
] as const;
export type StationeryMovementKind = (typeof STATIONERY_MOVEMENT_KINDS)[number];

export const STATIONERY_END_REASONS = [
    'misprinted',
    'damaged',
    'lost',
    'stolen',
    'not_found_at_count',
    'other'
] as const;
export type StationeryEndReason = (typeof STATIONERY_END_REASONS)[number];

/** The machine: from which statuses each event goes, and to which. `receive` creates the item. */
export const STATIONERY_TRANSITIONS: Record<
    Exclude<StationeryEvent, 'receive'>,
    { from: readonly StationeryStatus[]; to: StationeryStatus }
> = {
    allocate: { from: ['in_stock'], to: 'allocated' },
    accept: { from: ['allocated'], to: 'in_stock' },
    recall: { from: ['in_stock', 'allocated'], to: 'in_stock' },
    use: { from: ['in_stock'], to: 'used' },
    spoil: { from: ['in_stock'], to: 'spoiled' },
    void: { from: ['in_stock', 'allocated'], to: 'void' },
    lose: { from: ['in_stock', 'allocated'], to: 'missing' }
};

/** The status an item has after `event`, or null when the event cannot happen to an item in `from`. */
export function nextStationeryStatus(
    from: StationeryStatus,
    event: Exclude<StationeryEvent, 'receive'>
): StationeryStatus | null {
    const rule = STATIONERY_TRANSITIONS[event];
    return rule.from.includes(from) ? rule.to : null;
}

/** The most items one command takes (a delivery of stickers is counted in thousands). */
export const MAX_ITEMS = 10_000;
export const MAX_ITEM_KEYS = 1_000;
export const MAX_SERIAL = 99_999_999;

/**
 * A series is letters: Latin capitals, or Ethiopic syllables (U+1200–U+135A, never the Ethiopic numerals), since the
 * finance bureau's receipt vouchers are printed in series such as `ለ` and `ሐ`.
 */
export const SERIES_LETTERS = 'A-Z\\u1200-\\u135A';
const SERIES_PATTERN = new RegExp(`^[${SERIES_LETTERS}]{0,6}$`, 'u');
const KEY_PATTERN = new RegExp(`^([${SERIES_LETTERS}]*)(\\d{1,8})$`, 'u');

const series = z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
    .pipe(z.string().regex(SERIES_PATTERN, 'up to six letters'));
const serial = z.number().int().min(1).max(MAX_SERIAL);

/** An item's key: its series and its serial, zero-padded to the width it is printed with (`AB0001234`). */
export function stationeryKey(seriesText: string, serialNo: number, width: number): string {
    return `${seriesText}${String(serialNo).padStart(width, '0')}`;
}

/**
 * A key as typed (`AB 0001234`, `ab-1234`) split into its series and serial. A series is letters only, so the split is never
 * ambiguous: the letters, then the digits.
 */
export function parseStationeryKey(text: string): { series: string; serial: number; key: string } | null {
    const folded = text.trim().toUpperCase().replace(/[\s-]/g, '');
    const match = KEY_PATTERN.exec(folded);
    if (!match) return null;
    const head = match[1] ?? '';
    const digits = match[2] ?? '';
    const serialNo = Number(digits);
    if ([...head].length > 6 || serialNo < 1) return null;
    return { series: head, serial: serialNo, key: folded };
}

const itemKey = z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((text, ctx) => {
        const parsed = parseStationeryKey(text);
        if (!parsed) {
            ctx.addIssue({ code: 'custom', message: 'not a serial', params: { code: 'invalid_serial' } });
            return z.NEVER;
        }
        return parsed.key;
    });

const parsedKey = (key: string) => parseStationeryKey(key) ?? { series: '', serial: 0, key };

/** A run of one series (`AB` 1001–1500). */
export const stationeryRangeSchema = z
    .strictObject({ series: series.default(''), from: serial, to: serial })
    .refine((r) => r.to >= r.from, { path: ['to'], message: 'is before the first serial' })
    .refine((r) => r.to - r.from + 1 <= MAX_ITEMS, { path: ['to'], message: `at most ${MAX_ITEMS} items` });
export type StationeryRange = z.infer<typeof stationeryRangeSchema>;

/** Which items a command takes: a run of one series, or a list of serials. */
export const stationerySelectionSchema = z.union([
    stationeryRangeSchema,
    z.strictObject({
        keys: z
            .array(itemKey)
            .min(1)
            .max(MAX_ITEM_KEYS)
            .refine(
                (keys) => new Set(keys.map(parsedKey).map((k) => `${k.series}/${k.serial}`)).size === keys.length,
                'listed twice'
            )
    })
]);
export type StationerySelection = z.infer<typeof stationerySelectionSchema>;

/** The series and serials a selection names, in order. */
export function selectionSerials(selection: StationerySelection): { series: string; serial: number }[] {
    if ('keys' in selection)
        return selection.keys
            .map(parsedKey)
            .map((k) => ({ series: k.series, serial: k.serial }))
            .sort((a, b) => (a.series === b.series ? a.serial - b.serial : a.series < b.series ? -1 : 1));
    const out: { series: string; serial: number }[] = [];
    for (let n = selection.from; n <= selection.to; n += 1) out.push({ series: selection.series, serial: n });
    return out;
}

const isoDate = z.iso.date();
const note = z.string().trim().min(1).max(500).optional();
const kind = z.enum(STATIONERY_KINDS);

/** `POST /stationery/batches`: a delivery (from the ministry, the bureau or the printer), taken in by the acting unit. */
export const stationeryReceiveSchema = z
    .strictObject({
        kind,
        source: z.enum(STATIONERY_SOURCES).default('regional_bureau'),
        /** the dispatch or delivery-note number */
        reference: z.string().trim().min(1).max(60),
        receivedOn: isoDate,
        /** the plate code or category the forms are printed for, if any */
        variant: variant.optional(),
        /** the Ethiopian fiscal year the forms are valid for (a year's bolo stickers), if any */
        validEfy: z.number().int().min(2000).max(2100).optional(),
        /** what one item cost, in santim (the bureau's price list), for the stock's value */
        unitCostSantim: z
            .string()
            .regex(/^\d{1,12}$/, 'santim')
            .optional(),
        range: stationeryRangeSchema,
        /** the digits the serial is printed with (`0001234` is 7); by default those of the last serial */
        width: z.number().int().min(1).max(8).optional(),
        note
    })
    .refine((r) => r.width === undefined || String(r.range.to).length <= r.width, {
        path: ['width'],
        message: 'is narrower than the last serial'
    });
export type StationeryReceive = z.infer<typeof stationeryReceiveSchema>;

/** `POST /stationery/allocations`: items handed to a unit directly below. */
export const stationeryAllocationSchema = z.strictObject({
    kind,
    toUnitId: z.uuid(),
    items: stationerySelectionSchema,
    note
});
export type StationeryAllocation = z.infer<typeof stationeryAllocationSchema>;

/** `POST /stationery/movements/:id/acceptance`: the unit below takes what it was sent, all or all but some. */
export const stationeryAcceptanceSchema = z.strictObject({
    exceptKeys: z.array(itemKey).max(MAX_ITEM_KEYS).optional(),
    note
});
export type StationeryAcceptance = z.infer<typeof stationeryAcceptanceSchema>;

/** `POST /stationery/recalls`: items taken back from a unit directly below. */
export const stationeryRecallSchema = z.strictObject({
    kind,
    fromUnitId: z.uuid(),
    items: stationerySelectionSchema,
    reason: z.string().trim().min(10).max(500)
});
export type StationeryRecall = z.infer<typeof stationeryRecallSchema>;

/** `POST /stationery/write-offs`: items that will never be used: void (damaged) or missing (lost, stolen, not found). */
export const stationeryWriteOffSchema = z.strictObject({
    kind,
    status: z.enum(['void', 'missing']),
    items: stationerySelectionSchema,
    endReason: z.enum(['damaged', 'lost', 'stolen', 'not_found_at_count', 'other']),
    reason: z.string().trim().min(10).max(500)
});
export type StationeryWriteOff = z.infer<typeof stationeryWriteOffSchema>;

/**
 * `POST /stationery/closings`: the office counts what it holds of one kind and records it. Every item it should hold in stock
 * and did not count is flagged missing; every item it counted and should not hold is flagged unexpected. One a day per kind.
 */
export const stationeryClosingSchema = z.strictObject({
    kind,
    /** the day of the count: today (what is held is today's; a past day's stock is not recounted) */
    closedOn: isoDate,
    /** the runs physically on hand (an empty list: nothing on hand), at most MAX_ITEMS serials in all */
    counted: z
        .array(stationeryRangeSchema)
        .max(200)
        .refine((runs) => runs.reduce((n, r) => n + (r.to - r.from + 1), 0) <= MAX_ITEMS, {
            message: `at most ${MAX_ITEMS} serials in one count`
        }),
    note
});
export type StationeryClosingInput = z.infer<typeof stationeryClosingSchema>;

/** `GET /stationery/items` */
export const stationeryListQuerySchema = z.strictObject({
    kind: kind.optional(),
    variant: variant.optional(),
    q: z.string().trim().min(1).max(20).optional(),
    status: z.enum(STATIONERY_STATUSES).optional(),
    holderUnitId: z.uuid().optional(),
    after: z.string().max(20).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});
export type StationeryListQuery = z.infer<typeof stationeryListQuerySchema>;

/** `GET /stationery/movements` */
export const stationeryMovementListQuerySchema = z.strictObject({
    kind: kind.optional(),
    unitId: z.uuid().optional(),
    movement: z.enum(STATIONERY_MOVEMENT_KINDS).optional(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

/** `GET /stationery/summary?kind=` */
export const stationerySummaryQuerySchema = z.strictObject({ kind, unitId: z.uuid().optional() });

const unitRef = z.object({ id: z.uuid(), code: z.string(), name: z.record(z.string(), z.string()) });

export const stationeryItemSchema = z.object({
    id: z.uuid(),
    kind,
    variant: z.string().nullable(),
    validEfy: z.number().int().nullable(),
    key: z.string(),
    series: z.string(),
    serial: z.number().int(),
    status: z.enum(STATIONERY_STATUSES),
    statusOn: isoDate,
    holder: unitRef,
    /** what used it: a table and a row (a licence's print, a booklet's libre, a receipt) */
    usedFor: z.object({ table: z.string(), id: z.uuid() }).nullable(),
    caseId: z.uuid().nullable(),
    endReason: z.enum(STATIONERY_END_REASONS).nullable()
});
export type StationeryItem = z.infer<typeof stationeryItemSchema>;

export const stationeryMovementSchema = z.object({
    id: z.uuid(),
    kind,
    movement: z.enum(STATIONERY_MOVEMENT_KINDS),
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
    /** an allocation: how many of its items are still waiting to be accepted */
    awaiting: z.number().int().nullable()
});
export type StationeryMovement = z.infer<typeof stationeryMovementSchema>;

export const stationeryBatchSchema = z.object({
    id: z.uuid(),
    kind,
    source: z.enum(STATIONERY_SOURCES),
    variant: z.string().nullable(),
    validEfy: z.number().int().nullable(),
    unitCostSantim: z.string().nullable(),
    reference: z.string(),
    receivedOn: isoDate,
    receivingUnit: unitRef,
    quantity: z.number().int(),
    firstKey: z.string(),
    lastKey: z.string(),
    note: z.string().nullable()
});
export type StationeryBatch = z.infer<typeof stationeryBatchSchema>;

export const stationeryClosingSchemaOut = z.object({
    id: z.uuid(),
    kind,
    unit: unitRef,
    closedOn: isoDate,
    /** in stock at the office when it counted */
    expected: z.number().int(),
    counted: z.number().int(),
    /** expected and not counted (at most 200 listed; `missingCount` has them all) */
    missing: z.array(z.string()),
    missingCount: z.number().int(),
    /** counted and not expected: used, held by another unit, or not in the stock at all */
    unexpected: z.array(z.string()),
    unexpectedCount: z.number().int(),
    balanced: z.boolean(),
    note: z.string().nullable()
});
export type StationeryClosing = z.infer<typeof stationeryClosingSchemaOut>;

const counts = {
    /** items this unit took in: received, or accepted from above, less those recalled */
    received: z.number().int(),
    inStock: z.number().int(),
    /** sent to this unit and not yet accepted */
    inTransit: z.number().int(),
    used: z.number().int(),
    spoiled: z.number().int(),
    void: z.number().int(),
    missing: z.number().int(),
    /** held below this unit, whatever their status */
    allocatedDown: z.number().int()
};

/** A unit's counts of one kind, and whether its ledger agrees with what it holds. */
export const stationerySummaryRowSchema = z.object({
    unit: unitRef,
    holdsStationery: z.boolean(),
    ...counts,
    ledger: z.object({ received: z.number().int(), allocatedDown: z.number().int() }),
    reconciled: z.boolean(),
    /** the newest closing of this kind, if any */
    lastClosing: z.object({ closedOn: isoDate, balanced: z.boolean() }).nullable()
});
export type StationerySummaryRow = z.infer<typeof stationerySummaryRowSchema>;
export const stationerySummarySchema = z.object({
    kind,
    unit: stationerySummaryRowSchema,
    children: z.array(stationerySummaryRowSchema)
});
export type StationerySummary = z.infer<typeof stationerySummarySchema>;
