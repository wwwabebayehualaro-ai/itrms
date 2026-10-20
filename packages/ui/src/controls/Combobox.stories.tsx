import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { screen, userEvent, within } from 'storybook/test';

import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { Label } from '../primitives/label';
import { Combobox } from './Combobox';
import type { ComboboxOption } from './Combobox';

const meta = {
    title: 'Controls/Combobox',
    component: Combobox,
    // required by the type; every story renders its own state
    args: { options: [], value: null, onChange: () => undefined }
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

type WoredaKey = 'sodoZuria' | 'damotGale' | 'humbo' | 'ofa';
const KEYS: WoredaKey[] = ['sodoZuria', 'damotGale', 'humbo', 'ofa'];

function useOptions(): ComboboxOption<WoredaKey>[] {
    const words = useTexts({
        sodoZuria: TEXT.sodoZuria,
        damotGale: TEXT.damotGale,
        humbo: TEXT.humbo,
        ofa: TEXT.ofa
    });
    return KEYS.map((k) => ({ value: k, label: words[k], disabled: k === 'ofa' }));
}

/** Opens the list so its content is part of the accessibility check. */
const openList: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox'));
    await screen.findByRole('listbox');
};

function SingleDemo({
    initial = null,
    disabled,
    loading,
    invalid,
    clearable
}: {
    initial?: WoredaKey | null;
    disabled?: boolean;
    loading?: boolean;
    invalid?: boolean;
    clearable?: boolean;
}) {
    const options = useOptions();
    const words = useTexts({ placeholder: TEXT.selectWoreda, label: TEXT.woreda, noResults: TEXT.noResults });
    const [value, setValue] = useState<WoredaKey | null>(initial);
    return (
        <div className="flex min-h-72 max-w-xs flex-col gap-2">
            <Label htmlFor="woreda">
                <T text={TEXT.woreda} />
            </Label>
            <Combobox<WoredaKey>
                id="woreda"
                options={options}
                value={value}
                onChange={setValue}
                placeholder={words.placeholder}
                emptyMessage={words.noResults}
                clearLabel={words.label}
                clearable={clearable}
                disabled={disabled}
                loading={loading}
                invalid={invalid}
                aria-describedby={invalid ? 'woreda-error' : undefined}
            />
            {invalid && (
                <small id="woreda-error" className="text-destructive">
                    <T text={TEXT.requiredError} />
                </small>
            )}
        </div>
    );
}

export const Default: Story = { render: () => <SingleDemo initial="humbo" clearable />, play: openList };

export const Closed: Story = { render: () => <SingleDemo /> };

export const Disabled: Story = { render: () => <SingleDemo initial="damotGale" disabled /> };

export const Invalid: Story = { render: () => <SingleDemo invalid /> };

export const Loading: Story = { render: () => <SingleDemo loading /> };

function MultipleDemo() {
    const options = useOptions();
    const words = useTexts({ placeholder: TEXT.selectWoreda, noResults: TEXT.noResults });
    const [value, setValue] = useState<WoredaKey[]>(['sodoZuria', 'humbo']);
    return (
        <div className="flex min-h-72 max-w-xs flex-col gap-2">
            <Label htmlFor="woredas">
                <T text={TEXT.woreda} />
            </Label>
            <Combobox<WoredaKey>
                id="woredas"
                multiple
                options={options}
                value={value}
                onChange={setValue}
                placeholder={words.placeholder}
                emptyMessage={words.noResults}
            />
        </div>
    );
}

export const Multiple: Story = { render: () => <MultipleDemo />, play: openList };

function LongTextDemo() {
    const words = useTexts({ long: TEXT.longWoreda, other: TEXT.longLabel });
    const options: ComboboxOption<string>[] = [
        { value: 'a', label: words.long },
        { value: 'b', label: words.other }
    ];
    const [value, setValue] = useState<string | null>('a');
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="long">
                <T text={TEXT.longLabel} />
            </Label>
            <Combobox id="long" options={options} value={value} onChange={setValue} />
        </div>
    );
}

export const LongText: Story = { render: () => <LongTextDemo /> };
