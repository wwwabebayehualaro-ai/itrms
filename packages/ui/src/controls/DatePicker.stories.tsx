import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { screen, userEvent, within } from 'storybook/test';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Label } from '../primitives/label';
import { DatePicker } from './DatePicker';

const meta = {
    title: 'Controls/DatePicker',
    component: DatePicker,
    // required by the type; every story renders its own state
    args: { value: null, onChange: () => undefined }
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

// Fixed dates (local time, like the picker's own) so screenshots do not change with the day the tests run.
const FIXED = new Date(2026, 8, 11);
const MAX = new Date(2030, 11, 31);
const formatFixed = (d: Date) => d.toLocaleDateString('en-GB', { dateStyle: 'medium' });

const openCalendar: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    await screen.findByRole('dialog');
};

function PickerDemo({
    initial = null,
    disabled,
    invalid
}: {
    initial?: Date | null;
    disabled?: boolean;
    invalid?: boolean;
}) {
    const placeholder = useText(TEXT.pickDate);
    const [value, setValue] = useState<Date | null>(initial);
    return (
        <div className="flex min-h-96 max-w-xs flex-col gap-2">
            <Label htmlFor="inspection-date">
                <T text={TEXT.inspectionDate} />
            </Label>
            <DatePicker
                id="inspection-date"
                value={value}
                onChange={setValue}
                placeholder={placeholder}
                max={MAX}
                formatLabel={formatFixed}
                disabled={disabled}
                invalid={invalid}
                aria-describedby={invalid ? 'inspection-date-error' : undefined}
            />
            {invalid && (
                <small id="inspection-date-error" className="text-destructive">
                    <T text={TEXT.requiredError} />
                </small>
            )}
        </div>
    );
}

/** The calendar is opened by the play function so it is part of the accessibility check. */
export const Default: Story = { render: () => <PickerDemo initial={FIXED} />, play: openCalendar };

export const Empty: Story = { render: () => <PickerDemo /> };

export const Disabled: Story = { render: () => <PickerDemo initial={FIXED} disabled /> };

export const Invalid: Story = { render: () => <PickerDemo invalid /> };
