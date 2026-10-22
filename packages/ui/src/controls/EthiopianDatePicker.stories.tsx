import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { useTexts } from '../stories/locale';
import { Label } from '../primitives/label';
import { EthiopianDatePicker } from './EthiopianDatePicker';

const meta = {
    title: 'Controls/EthiopianDatePicker',
    component: EthiopianDatePicker
} satisfies Meta<typeof EthiopianDatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const LABELS = {
    placeholder: { am: 'ቀን ይምረጡ', en: 'Pick a date' },
    previousMonth: { am: 'ያለፈው ወር', en: 'Previous month' },
    nextMonth: { am: 'የሚቀጥለው ወር', en: 'Next month' },
    clear: { am: 'አጽዳ', en: 'Clear' },
    month: { am: 'ወር', en: 'Month' },
    year: { am: 'ዓመት', en: 'Year' },
    label: { am: 'የማመልከቻ ቀን', en: 'Application date' }
};

function Demo({ initial }: { initial: string | null }) {
    const [value, setValue] = useState<string | null>(initial);
    const { label, ...labels } = useTexts(LABELS);
    return (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="applied">{label}</Label>
            <EthiopianDatePicker id="applied" value={value} onChange={setValue} labels={labels} />
        </div>
    );
}

/** The stored value is Gregorian (`2026-10-22`); the person sees ጥቅምት 12 ቀን 2019 ዓ.ም. */
export const Default: Story = {
    args: { value: '2026-10-22', onChange: () => undefined, labels: {} as never },
    render: () => <Demo initial="2026-10-22" />
};

export const Empty: Story = {
    args: { value: null, onChange: () => undefined, labels: {} as never },
    render: () => <Demo initial={null} />
};
