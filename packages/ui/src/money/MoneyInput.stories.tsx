import type { Meta, StoryObj } from '@storybook/react-vite';
import { useId, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Label } from '../primitives/label';
import { T, useText } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { MoneyInput, MoneyText } from './MoneyInput';

const meta = {
    title: 'Controls/MoneyInput',
    component: MoneyInput,
    // required by the type; every story renders its own state
    args: { value: null, onValueChange: () => undefined }
} satisfies Meta<typeof MoneyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_MONEY = {
    unit: { am: 'ብር', en: 'Birr' },
    fee: { am: 'የመንጃ ፈቃድ ዕድሳት ክፍያ', en: 'Driver licence renewal fee' },
    feeHelp: { am: 'መጠኑን በብር ያስገቡ፤ ሳንቲም እስከ ሁለት አሃዝ።', en: 'Enter the amount in Birr; santim up to two digits.' },
    adjustment: { am: 'የማስተካከያ መጠን', en: 'Adjustment amount' },
    invalidAmount: { am: 'መጠኑ ከዝቅተኛው ክፍያ ያነሰ ነው።', en: 'The amount is below the minimum fee.' },
    boloFee: { am: 'የቦሎ ምርመራ ክፍያ', en: 'Bolo inspection fee' },
    penalty: { am: 'የመንገድ ትራፊክ ቅጣት', en: 'Road traffic penalty' },
    refund: { am: 'የተመለሰ ገንዘብ', en: 'Refund' },
    revenue: { am: 'ጠቅላላ ገቢ', en: 'Total revenue' }
} satisfies Record<string, StoryText>;

function MoneyDemo({
    initial = null,
    label = TEXT_MONEY.fee,
    allowNegative,
    invalid,
    disabled
}: {
    initial?: bigint | null;
    label?: StoryText;
    allowNegative?: boolean;
    invalid?: boolean;
    disabled?: boolean;
}) {
    const [value, setValue] = useState<bigint | null>(initial);
    const unit = useText(TEXT_MONEY.unit);
    const id = useId();
    const errorId = `${id}-error`;
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor={id}>
                <T text={label} />
            </Label>
            <MoneyInput
                id={id}
                value={value}
                onValueChange={setValue}
                unit={unit}
                allowNegative={allowNegative}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
            />
            {invalid && (
                <small id={errorId} className="text-destructive">
                    <T text={TEXT_MONEY.invalidAmount} />
                </small>
            )}
        </div>
    );
}

export const Empty: Story = {
    render: () => <MoneyDemo />
};

export const WithValue: Story = {
    render: () => <MoneyDemo initial={125050n} />
};

/** A refund or a correction can be negative; the field says so with `allowNegative`. */
export const AllowNegative: Story = {
    render: () => <MoneyDemo initial={-45000n} label={TEXT_MONEY.adjustment} allowNegative />
};

export const Invalid: Story = {
    render: () => <MoneyDemo initial={5000n} invalid />
};

export const Disabled: Story = {
    render: () => <MoneyDemo initial={125050n} disabled />
};

/** A labelled field with its help text. */
function LabelledDemo() {
    const [value, setValue] = useState<bigint | null>(null);
    const unit = useText(TEXT_MONEY.unit);
    const id = useId();
    const helpId = `${id}-help`;
    return (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor={id}>
                <T text={TEXT_MONEY.boloFee} />
            </Label>
            <MoneyInput id={id} value={value} onValueChange={setValue} unit={unit} aria-describedby={helpId} />
            <small id={helpId} className="text-muted-foreground">
                <T text={TEXT_MONEY.feeHelp} />
            </small>
        </div>
    );
}

export const Labelled: Story = {
    render: () => <LabelledDemo />
};

/** Typing "1250.5" is tidied to "1,250.50" on blur; a third decimal is refused. */
export const Typing: Story = {
    render: () => <MoneyDemo />,
    play: async ({ canvasElement }) => {
        const input = within(canvasElement).getByRole<HTMLInputElement>('textbox');
        await userEvent.type(input, '1250.5');
        await expect(input).toHaveValue('1250.5');
        await userEvent.tab();
        await expect(input).toHaveValue('1,250.50');
        await userEvent.type(input, '9');
        await expect(input).toHaveValue('1,250.50');
    }
};

function AmountsDemo() {
    const unit = useText(TEXT_MONEY.unit);
    return (
        <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-2">
            <dt>
                <T text={TEXT_MONEY.boloFee} />
            </dt>
            <dd className="text-end">
                <MoneyText santim={125050n} unit={unit} />
            </dd>
            <dt>
                <T text={TEXT_MONEY.penalty} />
            </dt>
            <dd className="text-end">
                <MoneyText santim={5n} unit={unit} />
            </dd>
            <dt>
                <T text={TEXT_MONEY.refund} />
            </dt>
            <dd className="text-end">
                <MoneyText santim={-45000n} unit={unit} />
            </dd>
            <dt>
                <T text={TEXT_MONEY.revenue} />
            </dt>
            <dd className="text-end">
                <MoneyText santim={1234567890100n} unit={unit} />
            </dd>
        </dl>
    );
}

/** Amounts for reading: tabular digits, so a column of amounts lines up. */
export const MoneyTextAmounts: Story = {
    render: () => <AmountsDemo />
};
