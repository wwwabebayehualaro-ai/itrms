import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { formatBirr, isGroupingInProgress, MAX_BIRR_DIGITS, parseBirr, stripCurrency } from './money';
import { MoneyInput } from './MoneyInput';

const LIMIT = 10n ** BigInt(MAX_BIRR_DIGITS + 2) - 1n; // the largest amount in santim
const santim = fc.bigInt({ min: -LIMIT, max: LIMIT });

describe('Birr text and santim', () => {
    it('every amount survives formatting and reading back exactly', () => {
        fc.assert(
            fc.property(santim, fc.boolean(), (value, grouping) => {
                const read = parseBirr(formatBirr(value, { grouping }), { allowNegative: true });
                expect(read).toEqual({ ok: true, santim: value });
            })
        );
    });

    it('reads Birr and up to two decimals digit by digit, never as a float', () => {
        const digits = (max: number) => fc.stringMatching(new RegExp(`^\\d{0,${max}}$`));
        fc.assert(
            fc.property(digits(MAX_BIRR_DIGITS), digits(2), (birr, cents) => {
                fc.pre(birr !== '' || cents !== '');
                const expected = BigInt(birr || '0') * 100n + BigInt(cents.padEnd(2, '0'));
                expect(parseBirr(`${birr}.${cents}`)).toEqual({ ok: true, santim: expected });
            })
        );
        // the classic float trap: 0.1 + 0.2 and 1.15 × 100 are exact here
        expect(parseBirr('0.30')).toEqual({ ok: true, santim: 30n });
        expect(parseBirr('1.15')).toEqual({ ok: true, santim: 115n });
    });

    it('never returns a number, whatever is typed', () => {
        fc.assert(
            fc.property(fc.string(), fc.boolean(), (text, allowNegative) => {
                const read = parseBirr(text, { allowNegative });
                if (read.ok) expect(read.santim === null || typeof read.santim === 'bigint').toBe(true);
            })
        );
    });

    it('refuses a third decimal, a negative amount unless allowed, and more than 15 digits of Birr', () => {
        expect(parseBirr('12.345')).toEqual({ ok: false, error: 'precision' });
        expect(parseBirr('-5')).toEqual({ ok: false, error: 'negative' });
        expect(parseBirr('-5', { allowNegative: true })).toEqual({ ok: true, santim: -500n });
        expect(parseBirr('1'.repeat(MAX_BIRR_DIGITS + 1))).toEqual({ ok: false, error: 'too-large' });
        expect(parseBirr('12a')).toEqual({ ok: false, error: 'format' });
        expect(parseBirr('s')).toEqual({ ok: false, error: 'format' });
    });

    it('reads grouping written with commas, spaces, no-break and narrow no-break spaces', () => {
        for (const text of ['1,250,000.50', '1 250 000.50', '1 250 000.50', '1 250 000.50'])
            expect(parseBirr(text)).toEqual({ ok: true, santim: 125000050n });
    });

    it('refuses a separator out of place, so a decimal comma is never read as thousands', () => {
        for (const text of ['12,50', '1.2,5', '1 2', '1,2345', ',100', '1,000.5,0', '12,500,00'])
            expect(parseBirr(text)).toEqual({ ok: false, error: 'format' });
        expect(isGroupingInProgress('1,25')).toBe(true);
        expect(isGroupingInProgress('12,50')).toBe(true);
        expect(isGroupingInProgress('1,250')).toBe(false);
        expect(isGroupingInProgress('1250')).toBe(false);
    });

    it('drops a currency word around a pasted amount', () => {
        expect(stripCurrency('ETB 1,250.50')).toBe('1,250.50');
        expect(stripCurrency('500 ብር')).toBe('500');
        expect(stripCurrency(' -12.5 Birr ')).toBe('-12.5');
    });

    it('formats grouped Birr with both santim digits', () => {
        expect(formatBirr(125050n)).toBe('1,250.50');
        expect(formatBirr(5n)).toBe('0.05');
        expect(formatBirr(-100000000n)).toBe('-1,000,000.00');
        expect(formatBirr(123456n, { grouping: false })).toBe('1234.56');
    });
});

describe('MoneyInput', () => {
    afterEach(cleanup);

    function Harness({ seen }: { seen: unknown[] }) {
        const [value, setValue] = useState<bigint | null>(null);
        return (
            <MoneyInput
                aria-label="amount"
                unit="ብር"
                value={value}
                onValueChange={(v) => {
                    seen.push(v);
                    setValue(v);
                }}
            />
        );
    }

    it('reports only bigint santim or null, and keeps showing an amount it can report', () => {
        fc.assert(
            fc.property(
                fc.array(fc.oneof(fc.string(), fc.stringMatching(/^[\d.,-]{0,8}$/)), { maxLength: 12 }),
                (typed) => {
                    const seen: unknown[] = [];
                    render(<Harness seen={seen} />);
                    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' });
                    for (const text of typed) fireEvent.change(input, { target: { value: text } });
                    for (const v of seen) expect(v === null || typeof v === 'bigint').toBe(true);
                    const last = seen.length ? seen.at(-1) : null;
                    if (isGroupingInProgress(input.value)) {
                        // "1,25": shown as typed, reported as no value, and marked invalid
                        expect(last).toBe(null);
                        expect(input).toHaveAttribute('aria-invalid', 'true');
                    } else {
                        const shown = parseBirr(input.value);
                        expect(shown.ok).toBe(true);
                        expect(shown.ok && shown.santim).toBe(last);
                    }
                    cleanup();
                }
            ),
            { numRuns: 60 }
        );
    });

    it('tidies the text on blur and takes a new value from outside', () => {
        const { rerender } = render(<MoneyInput aria-label="amount" value={null} onValueChange={() => undefined} />);
        const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' });
        rerender(<MoneyInput aria-label="amount" value={125050n} onValueChange={() => undefined} />);
        expect(input.value).toBe('1,250.50');
        fireEvent.blur(input);
        expect(input.value).toBe('1,250.50');
    });

    it('shows a value it could not have produced (negative, too many digits) without re-rendering forever', () => {
        for (const value of [-45000n, 10n ** 17n]) {
            render(<MoneyInput aria-label="amount" value={value} onValueChange={() => undefined} />);
            expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' }).value).toBe(formatBirr(value));
            cleanup();
        }
        const { rerender } = render(<MoneyInput aria-label="amount" value={null} onValueChange={() => undefined} />);
        rerender(<MoneyInput aria-label="amount" value={-45000n} onValueChange={() => undefined} />);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' }).value).toBe('-450.00');
    });

    it('keeps a decimal comma as typed and reports no value, never 100 times the amount', () => {
        const seen: unknown[] = [];
        render(<Harness seen={seen} />);
        const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' });
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.change(input, { target: { value: '12,50' } });
        expect(input.value).toBe('12,50');
        expect(seen).toEqual([1200n, null]);
        expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('pastes an amount with its currency word', () => {
        const seen: unknown[] = [];
        render(<Harness seen={seen} />);
        const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'amount' });
        fireEvent.paste(input, { clipboardData: { getData: () => 'ETB 1,250.50' } });
        expect(input.value).toBe('1,250.50');
        expect(seen).toEqual([125050n]);
    });
});
