import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { useTexts } from '../stories/locale';
import { TONES } from '../tokens/tokens';
import { StatusBadge } from './StatusBadge';

const meta = {
    title: 'Controls/StatusBadge',
    component: StatusBadge,
    args: { value: 'submitted' }
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const WORDS = {
    neutral: { am: 'ረቂቅ', en: 'Draft' },
    info: { am: 'ቀርቧል', en: 'Submitted' },
    progress: { am: 'በሂደት ላይ', en: 'In progress' },
    success: { am: 'ጸድቋል', en: 'Approved' },
    warning: { am: 'ተመልሷል', en: 'Returned' },
    danger: { am: 'ውድቅ ተደርጓል', en: 'Rejected' },
    muted: { am: 'ተሰርዟል', en: 'Cancelled' }
};

function AllTonesDemo() {
    const words = useTexts(WORDS);
    return (
        <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
                <StatusBadge key={tone} value={tone} label={words[tone]} tone={tone} />
            ))}
        </div>
    );
}

/** The shared vocabulary (design-system.md §6): seven tones, each with words and its own icon. */
export const AllTones: Story = {
    render: () => <AllTonesDemo />,
    play: async ({ canvasElement }) => {
        // Colour is never the only signal: every badge has words and an icon.
        for (const badge of canvasElement.querySelectorAll('[data-tone]')) {
            await expect(badge.textContent?.trim()).not.toBe('');
            await expect(badge.querySelector('svg')).not.toBeNull();
        }
        await expect(within(canvasElement).getAllByText(/./).length).toBeGreaterThanOrEqual(TONES.length);
    }
};

/** A stored status read as words; the tone comes from the usual workflow words. */
export const FromValue: Story = {
    args: { value: 'pending_approval' }
};
