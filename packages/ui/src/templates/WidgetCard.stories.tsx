import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../primitives/button';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { EmptyState } from './EmptyState';
import { WidgetCard } from './WidgetCard';

const meta = {
    title: 'Templates/WidgetCard',
    component: WidgetCard,
    // required by the type; every story renders its own state
    args: { title: '' },
    decorators: [
        (Story) => (
            <div className="max-w-md">
                <Story />
            </div>
        )
    ]
} satisfies Meta<typeof WidgetCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_WIDGET = {
    title: { am: 'የቅርብ ጊዜ ማመልከቻዎች', en: 'Recent applications' },
    description: { am: 'ባለፉት ሰባት ቀናት የቀረቡ', en: 'Submitted in the last seven days' },
    viewAll: { am: 'ሁሉንም ተመልከት', en: 'View all' },
    footer: { am: 'መጨረሻ የተዘመነው ዛሬ ጠዋት', en: 'Last updated this morning' },
    emptyTitle: { am: 'በዚህ ሳምንት ማመልከቻ አልቀረበም', en: 'No applications this week' }
} satisfies Record<string, StoryText>;

function ViewAll() {
    return (
        <Button variant="link" size="sm" className="h-auto p-0">
            <T text={TEXT_WIDGET.viewAll} />
        </Button>
    );
}

function RecentList() {
    const words = useTexts({
        a: PEOPLE[0].name,
        b: PEOPLE[1].name,
        c: PEOPLE[2].name
    });
    const rows = [
        { name: words.a, plate: PEOPLE[0].plate },
        { name: words.b, plate: PEOPLE[1].plate },
        { name: words.c, plate: PEOPLE[2].plate }
    ];
    return (
        <ul className="flex flex-col divide-y">
            {rows.map((r) => (
                <li key={r.plate} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{r.name}</span>
                    <span className="text-muted-foreground">{r.plate}</span>
                </li>
            ))}
        </ul>
    );
}

function Demo({
    title = TEXT_WIDGET.title,
    description,
    withFooter,
    withAction,
    loading,
    empty
}: {
    title?: StoryText;
    description?: StoryText;
    withFooter?: boolean;
    withAction?: boolean;
    loading?: boolean;
    empty?: boolean;
}) {
    const words = useTexts({ title, description: description ?? title, empty: TEXT_WIDGET.emptyTitle });
    return (
        <WidgetCard
            title={words.title}
            description={description ? words.description : undefined}
            action={withAction ? <ViewAll /> : undefined}
            footer={withFooter ? <T text={TEXT_WIDGET.footer} /> : undefined}
            loading={loading}
        >
            {empty ? <EmptyState title={words.empty} /> : <RecentList />}
        </WidgetCard>
    );
}

export const Default: Story = {
    render: () => <Demo />
};

export const WithActionAndFooter: Story = {
    render: () => <Demo description={TEXT_WIDGET.description} withAction withFooter />
};

export const Loading: Story = {
    render: () => <Demo description={TEXT_WIDGET.description} withAction loading />
};

export const WithEmptyState: Story = {
    render: () => <Demo withAction empty />
};

export const LongText: Story = {
    render: () => (
        <div className="w-72">
            <Demo title={TEXT.longWoreda} description={TEXT.longLabel} withAction withFooter />
        </div>
    )
};
