import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import { KeyValueEditor } from './KeyValueEditor';

const meta = {
    title: 'Form/KeyValueEditor',
    component: KeyValueEditor,
    // required by the type; every story renders its own state
    args: { onChange: () => undefined }
} satisfies Meta<typeof KeyValueEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

function EditorDemo({ initial, long }: { initial?: Record<string, string>; long?: boolean }) {
    const words = useTexts({ label: TEXT.headers, key: TEXT.key, value: TEXT.value, long: TEXT.longWoreda });
    const [value, setValue] = useState<Record<string, string> | undefined>(initial);
    const shown = long ? { office: words.long } : value;
    return (
        <div className="max-w-lg">
            <KeyValueEditor
                value={shown}
                onChange={setValue}
                aria-label={words.label}
                keyPlaceholder={words.key}
                valuePlaceholder={words.value}
            />
        </div>
    );
}

export const Default: Story = {
    render: () => <EditorDemo initial={{ 'x-office': 'sodo-zuria', plate: 'ETH-ABC-7788' }} />
};

export const Empty: Story = { render: () => <EditorDemo /> };

export const LongText: Story = { render: () => <EditorDemo long /> };
