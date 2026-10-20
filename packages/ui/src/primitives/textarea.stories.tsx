import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { Label } from './label';
import { Textarea } from './textarea';

const meta = {
    title: 'Primitives/Textarea',
    component: Textarea
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

function DefaultDemo() {
    const placeholder = useText(TEXT.notesPlaceholder);
    return (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="notes">
                <T text={TEXT.notes} />
            </Label>
            <Textarea id="notes" placeholder={placeholder} />
        </div>
    );
}

export const Default: Story = { render: () => <DefaultDemo /> };

export const Disabled: Story = {
    render: () => (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="notes-off">
                <T text={TEXT.notes} />
            </Label>
            <Textarea id="notes-off" disabled />
        </div>
    )
};

export const Invalid: Story = {
    render: () => (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="notes-bad">
                <T text={TEXT.notes} />
            </Label>
            <Textarea id="notes-bad" aria-invalid="true" aria-describedby="notes-bad-error" />
            <small id="notes-bad-error" className="text-destructive">
                <T text={TEXT.requiredError} />
            </small>
        </div>
    )
};

function LongTextDemo() {
    const value = useText(TEXT.applicationHelp);
    return (
        <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="notes-long">
                <T text={TEXT.longLabel} />
            </Label>
            <Textarea id="notes-long" defaultValue={value} />
        </div>
    );
}

export const LongText: Story = { render: () => <LongTextDemo /> };
