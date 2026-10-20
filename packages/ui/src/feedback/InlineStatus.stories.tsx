import type { Meta, StoryObj } from '@storybook/react-vite';

import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import { InlineStatus } from './InlineStatus';

const meta = {
    title: 'Feedback/InlineStatus',
    component: InlineStatus
} satisfies Meta<typeof InlineStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { loading: true } };

function ErrorDemo({ long }: { long?: boolean }) {
    const words = useTexts({ failed: TEXT.failed, long: TEXT.longLabel });
    return (
        <div className="max-w-xs">
            <InlineStatus error={long ? words.long : words.failed} onRetry={() => undefined} />
        </div>
    );
}

export const WithError: Story = { render: () => <ErrorDemo /> };

function EmptyDemo() {
    const words = useTexts({ empty: TEXT.noRecords });
    return <InlineStatus empty emptyMessage={words.empty} />;
}

export const Empty: Story = { render: () => <EmptyDemo /> };

/** A long Amharic error wraps beside the retry button. */
export const LongText: Story = { render: () => <ErrorDemo long /> };
