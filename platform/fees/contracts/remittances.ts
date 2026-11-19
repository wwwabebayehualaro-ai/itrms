/**
 * The remittance (task 1.12d, ADR-0063 §5): the office takes the closed cashier sessions up to a day to the bank under the
 * finance bureau's account codes. It covers the receipts of those sessions, less the reversals decided after a till was
 * counted (Finance refunds them); what goes to the bank is the counted cash less the floats that stay in the tills. The
 * database checks the same sums (migration 0095).
 */
import { i18nTextSchema, santimTextSchema } from '@itrms/schemas';
import { z } from 'zod';

/** The finance bureau's accounts the fee lines are booked to: a region's setting (placeholder codes until the zone confirms, Z). */
export const ACCOUNTS_SETTING = 'fees.accounts';
/** The office's counter of remittance numbers, gapless per fiscal year. */
export const REMITTANCE_COUNTER = 'fees.remittance';
export const REMITTANCE_PATTERN = '{unit}/RM/{seq:05}/{efy}';

/** settled: nothing to deposit (only bank-slip money, counted equal to the floats); a terminal state */
export const REMITTANCE_STATES = ['prepared', 'deposited', 'settled'] as const;
export type RemittanceState = (typeof REMITTANCE_STATES)[number];
export const REMITTANCE_LINE_KINDS = ['receipt', 'reversal'] as const;
export type RemittanceLineKind = (typeof REMITTANCE_LINE_KINDS)[number];

export const accountSchema = z.strictObject({
    code: z.string().trim().min(1).max(32),
    budgetCategory: z.string().trim().min(1).max(32),
    name: i18nTextSchema
});
export type Account = z.infer<typeof accountSchema>;

/**
 * The `fees.accounts` value: the account of a fee line by its key, and the default for a line not named. `demo` says the
 * codes are placeholders (printed on the document).
 */
export const accountsSettingSchema = z.strictObject({
    demo: z.boolean(),
    default: accountSchema,
    lines: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/), accountSchema)
});
export type AccountsSetting = z.infer<typeof accountsSettingSchema>;

export const DEFAULT_ACCOUNTS: AccountsSetting = {
    demo: true,
    default: {
        code: '0000',
        budgetCategory: 'PLACEHOLDER',
        name: { am: 'ጊዜያዊ የሂሳብ ኮድ (ማሳያ)', en: 'Placeholder account code (demo)' }
    },
    lines: {}
};

export const remittancePreviewQuerySchema = z.object({ through: z.iso.date() });
export const remittancePrepareSchema = z.strictObject({ through: z.iso.date() });
export type RemittancePrepareInput = z.infer<typeof remittancePrepareSchema>;

export const remittanceQuerySchema = z.object({
    state: z.enum(REMITTANCE_STATES).optional(),
    /** keyset: the last remittance's id (newest first) */
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const remittanceDepositSchema = z.strictObject({
    bank: z.string().regex(/^[A-Z0-9]{2,12}$/),
    reference: z.string().trim().min(3).max(40),
    depositedOn: z.iso.date(),
    amountSantim: santimTextSchema
});
export type RemittanceDepositInput = z.infer<typeof remittanceDepositSchema>;

const iso = z.iso.datetime({ offset: true });
const signed = z.string().regex(/^-?\d+$/);

const unitRef = z.object({ id: z.uuid(), code: z.string(), name: i18nTextSchema });

export const remittanceLineOutSchema = z.object({
    id: z.uuid(),
    kind: z.enum(REMITTANCE_LINE_KINDS),
    receiptId: z.uuid(),
    receiptNumber: z.string(),
    reversalId: z.uuid().nullable(),
    orderLinePosition: z.number().int(),
    lineKey: z.string(),
    accountCode: z.string(),
    budgetCategory: z.string(),
    accountName: i18nTextSchema,
    /** the line has no account of its own in the setting: the default took it (shown, to be reviewed) */
    mappedByDefault: z.boolean(),
    paymentMethod: z.enum(['cash', 'bank_slip']),
    /** negative for a reversal decided after the till was counted */
    amountSantim: signed
});
export type RemittanceLineOut = z.infer<typeof remittanceLineOutSchema>;

/** The lines of one account and budget category. */
export const remittanceGroupOutSchema = z.object({
    accountCode: z.string(),
    budgetCategory: z.string(),
    accountName: i18nTextSchema,
    mappedByDefault: z.boolean(),
    receiptSantim: signed,
    reversalSantim: signed,
    totalSantim: signed,
    lineCount: z.number().int()
});
export type RemittanceGroupOut = z.infer<typeof remittanceGroupOutSchema>;

export const remittanceSessionOutSchema = z.object({
    id: z.uuid(),
    cashierId: z.uuid(),
    businessDay: z.iso.date(),
    openingFloatSantim: santimTextSchema,
    cashReceiptsSantim: santimTextSchema,
    bankSlipSantim: santimTextSchema,
    receiptCount: z.number().int(),
    expectedCashSantim: santimTextSchema,
    countedSantim: santimTextSchema,
    differenceSantim: signed
});
export type RemittanceSessionOut = z.infer<typeof remittanceSessionOutSchema>;

export const notYetClosedOutSchema = z.object({
    id: z.uuid(),
    cashierId: z.uuid(),
    businessDay: z.iso.date(),
    state: z.string(),
    overdue: z.boolean()
});
export type NotYetClosedOut = z.infer<typeof notYetClosedOutSchema>;

const figures = {
    revenueTotalSantim: signed,
    cashSantim: santimTextSchema,
    bankSlipSantim: santimTextSchema,
    /** zero or less */
    reversalSantim: signed,
    differenceSantim: signed,
    depositDueSantim: santimTextSchema
};

/** What a prepare would give, nothing stored (no number yet). */
export const remittancePreviewSchema = z.object({
    through: z.iso.date(),
    periodFrom: z.iso.date().nullable(),
    ...figures,
    /** signed here: a negative amount to deposit cannot be prepared */
    depositDueSantim: signed,
    blocked: z.enum(['negative_due']).nullable(),
    demo: z.boolean(),
    sessions: z.array(remittanceSessionOutSchema),
    groups: z.array(remittanceGroupOutSchema),
    lineCount: z.number().int(),
    /** sessions up to the day that are not closed (open, counting, waiting for a decision): left out, overdue ones included */
    notYetClosed: z.array(notYetClosedOutSchema)
});
export type RemittancePreview = z.infer<typeof remittancePreviewSchema>;

export const remittanceDepositOutSchema = z.object({
    bank: z.string(),
    reference: z.string(),
    depositedOn: z.iso.date(),
    amountSantim: santimTextSchema,
    depositedBy: z.uuid(),
    depositedAt: iso
});

export const remittanceOutSchema = z.object({
    id: z.uuid(),
    number: z.string(),
    state: z.enum(REMITTANCE_STATES),
    periodFrom: z.iso.date(),
    periodTo: z.iso.date(),
    ...figures,
    sessionCount: z.number().int(),
    preparedBy: z.uuid(),
    preparedAt: iso,
    deposit: remittanceDepositOutSchema.nullable(),
    demo: z.boolean(),
    unit: unitRef
});
export type RemittanceOut = z.infer<typeof remittanceOutSchema>;

export const remittanceDetailSchema = remittanceOutSchema.extend({
    sessions: z.array(remittanceSessionOutSchema),
    groups: z.array(remittanceGroupOutSchema),
    lines: z.array(remittanceLineOutSchema)
});
export type RemittanceDetail = z.infer<typeof remittanceDetailSchema>;
