import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EthiopianDatePicker } from './EthiopianDatePicker';

const labels = {
    placeholder: 'Pick a date',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    clear: 'Clear',
    month: 'Month',
    year: 'Year'
};

/** The day buttons of the month shown (named by their full date). */
const daysOf = (month: string) => screen.getAllByRole<HTMLButtonElement>('button', { name: new RegExp(` ${month} `) });

const picker = (props: Partial<React.ComponentProps<typeof EthiopianDatePicker>> = {}) => (
    <EthiopianDatePicker
        value={null}
        onChange={() => undefined}
        labels={labels}
        language="en"
        aria-label="Date"
        {...props}
    />
);

describe('the Ethiopian date picker', () => {
    it('shows the stored Gregorian date Ethiopian, and stores the Ethiopian day picked as Gregorian', async () => {
        const onChange = vi.fn();
        render(picker({ value: '2026-10-22', onChange }));
        const trigger = screen.getByRole('button', { name: 'Date' });
        expect(trigger.textContent).toContain('12 Tikimt 2019 E.C.');
        await userEvent.click(trigger);
        // Tikimt has 30 days, in rows of a week; the 12th is chosen
        expect(daysOf('Tikimt')).toHaveLength(30);
        expect(screen.getAllByRole('row').length).toBeGreaterThan(4);
        const chosen = screen.getByRole('button', { name: '12 Tikimt 2019 E.C.' });
        expect(chosen.closest('[role="gridcell"]')?.getAttribute('aria-selected')).toBe('true');
        await userEvent.click(screen.getByRole('button', { name: '1 Tikimt 2019 E.C.' }));
        expect(onChange).toHaveBeenCalledWith('2026-10-11');
    });

    it('gives Pagume 6 days in a leap year and 5 otherwise, and keeps to the allowed range', async () => {
        const { unmount } = render(picker({ value: '2027-09-10' }));
        // 10 September 2027 is Pagume 5, 2019, a leap year
        await userEvent.click(screen.getByRole('button', { name: 'Date' }));
        expect(daysOf('Pagume')).toHaveLength(6);
        unmount();
        render(picker({ value: '2026-09-10', max: '2026-09-08' }));
        await userEvent.click(screen.getByRole('button', { name: 'Date' }));
        // Pagume 2018 has 5 days; after the 3rd (8 September 2026) nothing may be picked
        expect(daysOf('Pagume').map((d) => d.disabled)).toEqual([false, false, false, true, true]);
        // the day that takes the keyboard is one that may be picked
        expect(daysOf('Pagume').find((d) => d.tabIndex === 0)?.disabled).toBe(false);
    });

    it('keeps a day reachable by keyboard in a shorter month, and walks across months with the arrows', async () => {
        render(picker({ value: '2026-09-10' }));
        await userEvent.click(screen.getByRole('button', { name: 'Date' }));
        // Pagume 5: one day on is Meskerem 1 of the next year
        screen.getByRole('button', { name: '5 Pagume 2018 E.C.' }).focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(
            daysOf('Meskerem')
                .find((d) => d.tabIndex === 0)
                ?.getAttribute('aria-label')
        ).toBe('1 Meskerem 2019 E.C.');
        // back in Pagume (5 days), exactly one day is in the tab order
        await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
        expect(daysOf('Pagume').filter((d) => d.tabIndex === 0)).toHaveLength(1);
    });

    it('treats a date that does not exist as no date', () => {
        render(picker({ value: '2026-13-45' }));
        expect(screen.getByRole('button', { name: 'Date' }).textContent).toContain('Pick a date');
    });
});
