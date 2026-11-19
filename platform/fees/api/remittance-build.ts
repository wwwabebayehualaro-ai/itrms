/**
 * The arithmetic of a remittance (task 1.12d, ADR-0063 §5), without the database: which account each fee line is booked to,
 * the lines (a receipt's, and the negative ones of a receipt reversed after its till was counted), their totals, and what goes
 * to the bank. The service reads the rows; the database checks the same sums at commit (migration 0095). Money is BigInt
 * santim.
 */
import type { I18nText } from '@itrms/schemas';

import type { Account, AccountsSetting } from '../contracts/remittances';

export type PaymentMethod = 'cash' | 'bank_slip';

/** A line of a receipt that is in the frozen figures of a covered session. */
export interface ReceiptLineInput {
    receiptId: string;
    orderLinePosition: number;
    lineKey: string;
    method: PaymentMethod;
    amountSantim: bigint;
}

/** A line of a receipt reversed after its till was counted; `frozen` is the account its receipt's line was booked to earlier. */
export interface LateReversalInput {
    reversalId: string;
    receiptId: string;
    orderLinePosition: number;
    lineKey: string;
    method: PaymentMethod;
    /** the order line's amount (positive): the line written is its negative */
    amountSantim: bigint;
    frozen?: BookedAccount;
}

export interface BookedAccount {
    accountCode: string;
    budgetCategory: string;
    accountName: I18nText;
    mappedByDefault: boolean;
}

export interface BuiltLine extends BookedAccount {
    kind: 'receipt' | 'reversal';
    receiptId: string;
    reversalId: string | null;
    orderLinePosition: number;
    lineKey: string;
    paymentMethod: PaymentMethod;
    /** positive for a receipt, negative for a reversal */
    amountSantim: bigint;
}

export interface RemittanceTotals {
    /** the receipts less the reversals */
    revenueTotal: bigint;
    cash: bigint;
    bankSlip: bigint;
    /** zero or less */
    reversal: bigint;
}

/** The account of a fee line: its own in the setting, else the default (flagged). */
export function bookTo(accounts: AccountsSetting, lineKey: string): BookedAccount {
    const own: Account | undefined = Object.hasOwn(accounts.lines, lineKey) ? accounts.lines[lineKey] : undefined;
    const account = own ?? accounts.default;
    return {
        accountCode: account.code,
        budgetCategory: account.budgetCategory,
        accountName: account.name,
        mappedByDefault: own === undefined
    };
}

export function buildRemittance(
    receiptLines: readonly ReceiptLineInput[],
    lateReversals: readonly LateReversalInput[],
    accounts: AccountsSetting
): { lines: BuiltLine[]; totals: RemittanceTotals } {
    const lines: BuiltLine[] = [];
    const booked = new Map<string, BookedAccount>();
    let cash = 0n;
    let bankSlip = 0n;
    for (const l of receiptLines) {
        if (l.amountSantim <= 0n) throw new Error(`remittance: a receipt line of ${l.amountSantim} santim`);
        const account = bookTo(accounts, l.lineKey);
        booked.set(`${l.receiptId}:${l.orderLinePosition}`, account);
        lines.push({
            ...account,
            kind: 'receipt',
            receiptId: l.receiptId,
            reversalId: null,
            orderLinePosition: l.orderLinePosition,
            lineKey: l.lineKey,
            paymentMethod: l.method,
            amountSantim: l.amountSantim
        });
        if (l.method === 'cash') cash += l.amountSantim;
        else bankSlip += l.amountSantim;
    }
    let reversal = 0n;
    for (const r of lateReversals) {
        // the account the receipt's line was booked to, on this remittance or an earlier one (never worked out again)
        const account = r.frozen ?? booked.get(`${r.receiptId}:${r.orderLinePosition}`);
        if (!account) throw new Error(`remittance: the reversal ${r.reversalId} has no booked receipt line`);
        lines.push({
            ...account,
            kind: 'reversal',
            receiptId: r.receiptId,
            reversalId: r.reversalId,
            orderLinePosition: r.orderLinePosition,
            lineKey: r.lineKey,
            paymentMethod: r.method,
            amountSantim: -r.amountSantim
        });
        reversal -= r.amountSantim;
    }
    return { lines, totals: { revenueTotal: cash + bankSlip + reversal, cash, bankSlip, reversal } };
}

/** A covered session as the closing left it. */
export interface SessionFigures {
    openingFloatSantim: bigint;
    expectedSantim: bigint;
    countedSantim: bigint;
}

/**
 * What goes to the bank: the counted cash less the floats that stay in the tills (reversals after the close do not reduce it,
 * Finance refunds them); and the signed difference counted less expected over the sessions.
 */
export function depositFigures(sessions: readonly SessionFigures[]): { depositDue: bigint; difference: bigint } {
    let depositDue = 0n;
    let difference = 0n;
    for (const s of sessions) {
        depositDue += s.countedSantim - s.openingFloatSantim;
        difference += s.countedSantim - s.expectedSantim;
    }
    return { depositDue, difference };
}

export interface LineGroup {
    accountCode: string;
    budgetCategory: string;
    accountName: I18nText;
    mappedByDefault: boolean;
    receipt: bigint;
    reversal: bigint;
    lineCount: number;
}

/** The lines by account code and budget category, in the order the first of each appears. */
export function groupLines(
    lines: readonly Pick<
        BuiltLine,
        'accountCode' | 'budgetCategory' | 'accountName' | 'mappedByDefault' | 'kind' | 'amountSantim'
    >[]
): LineGroup[] {
    const groups = new Map<string, LineGroup>();
    for (const l of lines) {
        const key = `${l.accountCode}\u0000${l.budgetCategory}`;
        let g = groups.get(key);
        if (!g) {
            g = {
                accountCode: l.accountCode,
                budgetCategory: l.budgetCategory,
                accountName: l.accountName,
                mappedByDefault: false,
                receipt: 0n,
                reversal: 0n,
                lineCount: 0
            };
            groups.set(key, g);
        }
        // one flagged line flags the group
        g.mappedByDefault = g.mappedByDefault || l.mappedByDefault;
        if (l.kind === 'receipt') g.receipt += l.amountSantim;
        else g.reversal += l.amountSantim;
        g.lineCount += 1;
    }
    return [...groups.values()].sort(
        (a, b) => a.accountCode.localeCompare(b.accountCode) || a.budgetCategory.localeCompare(b.budgetCategory)
    );
}
