import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import { Label } from '../primitives/label';
import { TagsInput } from './TagsInput';

const meta = {
    title: 'Controls/TagsInput',
    component: TagsInput,
    // required by the type; every story renders its own state
    args: { value: [], onChange: () => undefined }
} satisfies Meta<typeof TagsInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function TagsDemo({
    initial,
    disabled,
    invalid,
    long
}: {
    initial?: 'some' | 'long';
    disabled?: boolean;
    invalid?: boolean;
    long?: boolean;
}) {
    const words = useTexts({
        placeholder: TEXT.tagsPlaceholder,
        a: TEXT.tagA,
        b: TEXT.tagB,
        long: TEXT.longWoreda
    });
    const start = initial === 'some' ? [words.a, words.b] : initial === 'long' ? [words.long, words.a] : [];
    const [value, setValue] = useState<string[]>(start);
    return (
        <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="tags">
                <T text={long ? TEXT.longLabel : TEXT.tags} />
            </Label>
            <TagsInput
                id="tags"
                value={value}
                onChange={setValue}
                placeholder={words.placeholder}
                disabled={disabled}
                invalid={invalid}
                aria-describedby={invalid ? 'tags-error' : undefined}
            />
            {invalid && (
                <small id="tags-error" className="text-destructive">
                    <T text={TEXT.requiredError} />
                </small>
            )}
        </div>
    );
}

export const Default: Story = { render: () => <TagsDemo initial="some" /> };

export const Empty: Story = { render: () => <TagsDemo /> };

export const Invalid: Story = { render: () => <TagsDemo invalid /> };

export const LongText: Story = { render: () => <TagsDemo initial="long" long /> };
