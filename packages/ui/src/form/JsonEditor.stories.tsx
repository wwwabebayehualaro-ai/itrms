import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Label } from '../primitives/label';
import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import { JsonEditor } from './JsonEditor';

const meta = {
    title: 'Form/JsonEditor',
    component: JsonEditor,
    // required by the type; every story renders its own editor
    args: { value: undefined, onChange: () => undefined }
} satisfies Meta<typeof JsonEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE = { fee: 250, currency: 'ETB', grades: ['A', 'B'] };

function EditorDemo({ value, typing }: { value?: unknown; typing?: boolean }) {
    const label = useText(TEXT.json);
    return (
        <div className="flex max-w-md flex-col gap-2">
            <Label htmlFor="json">
                <T text={TEXT.json} />
            </Label>
            <JsonEditor id="json" aria-label={label} value={value} onChange={() => undefined} rows={typing ? 3 : 6} />
        </div>
    );
}

export const Default: Story = { render: () => <EditorDemo value={SAMPLE} /> };

export const Empty: Story = { render: () => <EditorDemo /> };

/** The editor only commits valid JSON; the play function types a broken value to show the message. */
export const Invalid: Story = {
    render: () => <EditorDemo typing />,
    play: async ({ canvasElement }) => {
        const box = within(canvasElement).getByRole('textbox');
        await userEvent.type(box, '{{"fee":');
        await expect(box).toHaveAttribute('aria-invalid', 'true');
    }
};
