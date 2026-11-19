/**
 * Cashier sessions and the daily closing (task 1.12, ADR-0063): one cashier, one office, one business day. The first payment
 * of the day opens the session (a float of zero) unless the cashier opened it with a float; the cashier counts the till; a
 * difference waits for another person's decision. The database checks the same moves (migration 0094).
 */
import { santimTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** The roles that may decide a count with a difference (never the cashier who counted). */
export const SESSION_APPROVER_ROLES_SETTING = 'fees.sessions.approverRoles';
/** The denominations of the till, in santim, largest first (Birr notes and coins; a region's list, assumption). */
export const DENOMINATIONS_SETTING = 'fees.sessions.denominations';
export const DEFAULT_DENOMINATIONS = [20000, 10000, 5000, 1000, 500, 100, 50, 25, 10, 5] as const;

export const SESSION_STATES = ['open', 'pending_approval', 'counting', 'closed'] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const COUNT_STATES = ['balanced', 'pending', 'approved', 'rejected'] as const;
export type CountState = (typeof COUNT_STATES)[number];
export const SESSION_OPENED_VIA = ['explicit', 'payment'] as const;

export const sessionApproverRolesSchema = z
    .array(z.string().regex(/^[a-z][a-z0-9_.]{1,62}$/))
    .min(1)
    .max(10);
export const denominationsSettingSchema = z
    .array(z.number().int().min(1).max(100_000_000))
    .min(1)
    .max(30)
    .refine((v) => new Set(v).size === v.length, 'a denomination once');

const santimInt = santimTextSchema;

export const sessionOpenSchema = z.strictObject({ openingFloatSantim: santimInt.default('0') });

export const denominationSchema = z.strictObject({
    valueSantim: z.number().int().min(1).max(100_000_000),
    count: z.number().int().min(0).max(1_000_000)
});
export type DenominationInput = z.infer<typeof denominationSchema>;

export const sessionCountSchema = z.strictObject({
    countedSantim: santimInt,
    denominations: z.array(denominationSchema).max(30).optional(),
    note: z.string().trim().max(500).optional()
});
export type SessionCountInput = z.infer<typeof sessionCountSchema>;

export const countDecisionSchema = z.strictObject({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).optional()
});

export const sessionQuerySchema = z.object({
    state: z.enum(SESSION_STATES).optional(),
    /** keyset: the last session's id (newest business day first) */
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

const iso = z.iso.datetime({ offset: true });

/** What the sum of a count's denominations is: BigInt, never a float. */
export const denominationTotal = (rows: readonly DenominationInput[]): bigint =>
    rows.reduce((sum, r) => sum + BigInt(r.valueSantim) * BigInt(r.count), 0n);

export const sessionCountOutSchema = z.object({
    id: z.uuid(),
    attempt: z.number().int(),
    countedSantim: santimTextSchema,
    expectedSantim: santimTextSchema,
    differenceSantim: z.string().regex(/^-?\d+$/),
    denominations: z.array(denominationSchema).nullable(),
    note: z.string().nullable(),
    countedBy: z.uuid(),
    countedAt: iso,
    state: z.enum(COUNT_STATES),
    decidedBy: z.uuid().nullable(),
    decidedAt: iso.nullable(),
    decisionNote: z.string().nullable()
});
export type SessionCountOut = z.infer<typeof sessionCountOutSchema>;

export const cashierSessionOutSchema = z.object({
    id: z.uuid(),
    cashierId: z.uuid(),
    businessDay: z.iso.date(),
    state: z.enum(SESSION_STATES),
    openedVia: z.enum(SESSION_OPENED_VIA),
    openedAt: iso,
    openingFloatSantim: santimTextSchema,
    /** an earlier day's session still open: shown, never blocking */
    overdue: z.boolean(),
    /** cash taken so far (live) or, once counted, frozen at the first count */
    cashReceiptsSantim: santimTextSchema,
    bankSlipSantim: santimTextSchema,
    receiptCount: z.number().int(),
    expectedCashSantim: santimTextSchema,
    tillClosedAt: iso.nullable(),
    closedAt: iso.nullable(),
    unit: z.object({ id: z.uuid(), code: z.string() }),
    counts: z.array(sessionCountOutSchema)
});
export type CashierSessionOut = z.infer<typeof cashierSessionOutSchema>;

/** The closing screen's read-only figures beside the session itself. */
export const cashierSessionDetailSchema = cashierSessionOutSchema.extend({
    voidedReceiptCount: z.number().int(),
    voidedSantim: santimTextSchema,
    pendingReversals: z.number().int(),
    pendingExternalRefs: z.number().int(),
    receiptLeafClosings: z.array(
        z.object({
            closedOn: z.iso.date(),
            expected: z.number().int(),
            counted: z.number().int(),
            missingCount: z.number().int()
        })
    ),
    denominations: z.array(z.number().int())
});
export type CashierSessionDetail = z.infer<typeof cashierSessionDetailSchema>;
