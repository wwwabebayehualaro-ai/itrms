import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from '../primitives/input';
import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import { LabeledField } from './LabeledField';

const meta = {
    title: 'Form/LabeledField',
    component: LabeledField,
    // required by the type; every story renders its own field
    args: { label: '', children: null }
} satisfies Meta<typeof LabeledField>;

export default meta;
type Story = StoryObj<typeof meta>;

function FieldDemo({ long }: { long?: boolean }) {
    const words = useTexts({ label: TEXT.phone, longLabel: TEXT.longLabel, help: TEXT.applicationHelp });
    return (
        <div className="max-w-sm">
            <LabeledField label={long ? words.longLabel : words.label} help={words.help} htmlFor="labeled-input">
                <Input id="labeled-input" />
            </LabeledField>
        </div>
    );
}

export const Default: Story = { render: () => <FieldDemo /> };

export const LongText: Story = { render: () => <FieldDemo long /> };

function NoHelpDemo() {
    const words = useTexts({ label: TEXT.plateNumber });
    return (
        <div className="max-w-sm">
            <LabeledField label={words.label} htmlFor="labeled-plate">
                <Input id="labeled-plate" />
            </LabeledField>
        </div>
    );
}

export const WithoutHelp: Story = { render: () => <NoHelpDemo /> };
