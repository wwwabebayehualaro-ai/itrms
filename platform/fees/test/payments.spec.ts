/**
 * The cashier's rules that need no database (task 0.22b): a due date, a slip reference as compared, what a payment sends.
 */
import { describe, expect, it } from 'vitest';

import { FEES_SETTINGS, paymentInputSchema } from '../contracts';
import { dayAfter } from '../api/payment-orders.service';
import { normalisedReference } from '../api/payments.service';

describe('a payment order', () => {
    it('is due a number of calendar days after it is made, across months and years', () => {
        expect(dayAfter('2026-11-01', 30)).toBe('2026-12-01');
        expect(dayAfter('2026-12-15', 30)).toBe('2027-01-14');
        expect(dayAfter('2028-02-28', 1)).toBe('2028-02-29');
    });
});

describe('a bank slip', () => {
    it('is compared by its reference in capitals, without spaces or dashes', () => {
        expect(normalisedReference('ft 26-0001')).toBe('FT260001');
        expect(normalisedReference('FT26 00 01')).toBe('FT260001');
    });
});

describe('a payment', () => {
    const cash = { method: 'cash', amountSantim: '40000', receivedFrom: 'Generated Applicant' };

    it('names its slip when it is paid by one, and none when in cash', () => {
        expect(paymentInputSchema.safeParse(cash).success).toBe(true);
        expect(paymentInputSchema.safeParse({ ...cash, method: 'bank_slip' }).success).toBe(false);
        expect(
            paymentInputSchema.safeParse({
                ...cash,
                bankSlip: { bank: 'CBE', reference: 'FT1234', paidOn: '2026-11-01' }
            }).success
        ).toBe(false);
    });

    it('is an amount in santim digits, never a decimal, and a pad leaf of digits', () => {
        expect(paymentInputSchema.safeParse({ ...cash, amountSantim: '400.00' }).success).toBe(false);
        expect(paymentInputSchema.safeParse({ ...cash, amountSantim: '-1' }).success).toBe(false);
        expect(paymentInputSchema.safeParse({ ...cash, pad: { series: 'WB-07', serial: '12a' } }).success).toBe(false);
        // one leaf, one value: no leading zeros
        expect(paymentInputSchema.safeParse({ ...cash, pad: { series: 'WB-07', serial: '0123' } }).success).toBe(false);
        expect(paymentInputSchema.safeParse({ ...cash, pad: { series: 'WB-07', serial: '123' } }).success).toBe(true);
    });

    it("takes its office's receipt source and the region's banks from settings of their own shape", () => {
        expect(FEES_SETTINGS['fees.receipts.source'].safeParse('pad').success).toBe(true);
        expect(FEES_SETTINGS['fees.receipts.source'].safeParse('paper').success).toBe(false);
        expect(
            FEES_SETTINGS['fees.payments.banks'].safeParse([{ code: 'CBE', name: { am: 'ንግድ', en: 'CBE' } }]).success
        ).toBe(true);
    });
});
