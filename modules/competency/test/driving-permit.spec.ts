/**
 * The card's handover as the desk records it (task 1.6d, ADR-0064 §7): the recipient, the ID they showed, and a representative only
 * when it is one.
 */
import { describe, expect, it } from 'vitest';

import { cardHandoverSchema, isIdNumber } from '../contracts';

describe('a card handover', () => {
    it('takes an ID number of letters, digits, "-" or "/", up to 40', () => {
        for (const ok of ['1234-5678-9012', 'EP1234567', 'WOL/KB/0042', 'a'.repeat(40)])
            expect(isIdNumber(ok), ok).toBe(true);
        for (const bad of ['', '1234 5678', 'ID#1', 'a'.repeat(41), 'ፋይዳ12']) expect(isIdNumber(bad), bad).toBe(false);
    });

    it('names a representative when one takes the card, and only then', () => {
        const base = { cardSerial: 'PC-1', idKind: 'fayda', idNumber: '1234-5678-9012' };
        expect(cardHandoverSchema.safeParse({ ...base, recipient: 'holder' }).success).toBe(true);
        expect(
            cardHandoverSchema.safeParse({ ...base, recipient: 'representative', representativeName: 'Sample Person' })
                .success
        ).toBe(true);
        expect(cardHandoverSchema.safeParse({ ...base, recipient: 'representative' }).success).toBe(false);
        expect(
            cardHandoverSchema.safeParse({ ...base, recipient: 'holder', representativeName: 'Sample Person' }).success
        ).toBe(false);
        expect(cardHandoverSchema.safeParse({ ...base, recipient: 'holder', idKind: 'library_card' }).success).toBe(
            false
        );
    });
});
