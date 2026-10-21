import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../primitives/button';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { EmptyState } from './EmptyState';

const meta = {
    title: 'Templates/EmptyState',
    component: EmptyState,
    parameters: { layout: 'padded' },
    // required by the type; every story renders its own state
    args: { title: '' }
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_EMPTY = {
    emptyTitle: { am: 'ገና ምንም ማመልከቻ የለም', en: 'There are no applications yet' },
    emptyBody: {
        am: 'የመጀመሪያውን የመንጃ ፈቃድ ማመልከቻ በመፍጠር ይጀምሩ።',
        en: 'Start by creating the first driver licence application.'
    },
    emptyAction: { am: 'ማመልከቻ ፍጠር', en: 'Create an application' },
    noResultsTitle: { am: 'ከፍለጋዎ ጋር የሚመሳሰል የለም', en: 'Nothing matches your search' },
    noResultsBody: {
        am: 'ማጣሪያዎቹን ያስወግዱ ወይም ሌላ የሰሌዳ ቁጥር ይፈልጉ።',
        en: 'Remove the filters or search for another plate number.'
    },
    clearFilters: { am: 'ማጣሪያዎችን አጽዳ', en: 'Clear filters' },
    errorTitle: { am: 'ዝርዝሩን መጫን አልተቻለም', en: 'The list could not be loaded' },
    errorBody: {
        am: 'ግንኙነቱ ተቋርጧል። እባክዎ እንደገና ይሞክሩ።',
        en: 'The connection was lost. Please try again.'
    }
} satisfies Record<string, StoryText>;

function Demo({
    variant,
    title,
    description,
    action
}: {
    variant: 'empty' | 'no-results' | 'error';
    title: StoryText;
    description?: StoryText;
    action?: StoryText;
}) {
    const words = useTexts({ title, description: description ?? title });
    return (
        <EmptyState
            variant={variant}
            title={words.title}
            description={description ? words.description : undefined}
            action={
                action ? (
                    <Button variant={variant === 'empty' ? 'default' : 'outline'}>
                        <T text={action} />
                    </Button>
                ) : undefined
            }
        />
    );
}

export const Empty: Story = {
    render: () => (
        <Demo
            variant="empty"
            title={TEXT_EMPTY.emptyTitle}
            description={TEXT_EMPTY.emptyBody}
            action={TEXT_EMPTY.emptyAction}
        />
    )
};

export const NoResults: Story = {
    render: () => (
        <Demo
            variant="no-results"
            title={TEXT_EMPTY.noResultsTitle}
            description={TEXT_EMPTY.noResultsBody}
            action={TEXT_EMPTY.clearFilters}
        />
    )
};

export const ErrorState: Story = {
    render: () => (
        <Demo variant="error" title={TEXT_EMPTY.errorTitle} description={TEXT_EMPTY.errorBody} action={TEXT.retry} />
    )
};

export const TitleOnly: Story = {
    render: () => <Demo variant="empty" title={TEXT.noRecords} />
};

export const LongText: Story = {
    render: () => (
        <div className="max-w-sm">
            <Demo variant="no-results" title={TEXT.longWoreda} description={TEXT.longLabel} action={TEXT.retry} />
        </div>
    )
};
