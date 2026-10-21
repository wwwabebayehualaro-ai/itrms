import type { Meta, StoryObj } from '@storybook/react-vite';

import { MoneyText } from '../money/MoneyInput';
import { Button } from '../primitives/button';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { KpiTile } from './KpiTile';
import type { KpiDelta } from './KpiTile';

const meta = {
    title: 'Templates/KpiTile',
    component: KpiTile,
    // required by the type; every story renders its own state
    args: { label: '', value: '' },
    decorators: [
        (Story) => (
            <div className="max-w-64">
                <Story />
            </div>
        )
    ]
} satisfies Meta<typeof KpiTile>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_KPI = {
    issued: { am: 'የተሰጡ የመንጃ ፈቃዶች', en: 'Driver licences issued' },
    overdue: { am: 'ጊዜ ያለፈባቸው ማመልከቻዎች', en: 'Overdue applications' },
    revenue: { am: 'የዚህ ወር ገቢ', en: 'Revenue this month' },
    birr: { am: 'ብር', en: 'Birr' },
    up: { am: '+12 ከባለፈው ወር', en: '+12 since last month' },
    down: { am: '-3 ከባለፈው ወር', en: '-3 since last month' },
    flat: { am: 'ከባለፈው ወር ለውጥ የለም', en: 'No change since last month' },
    hint: { am: 'እስከ ዛሬ የተመዘገቡ', en: 'Registered up to today' },
    viewList: { am: 'ዝርዝሩን ተመልከት', en: 'View the list' }
} satisfies Record<string, StoryText>;

function Demo({
    label = TEXT_KPI.issued,
    delta,
    hint,
    withAction,
    loading,
    money,
    value = '1,284'
}: {
    label?: StoryText;
    delta?: { text: StoryText; direction: KpiDelta['direction']; sentiment?: KpiDelta['sentiment'] };
    hint?: StoryText;
    withAction?: boolean;
    loading?: boolean;
    money?: boolean;
    value?: string;
}) {
    const words = useTexts({
        label,
        delta: delta?.text ?? label,
        hint: hint ?? label,
        unit: TEXT_KPI.birr
    });
    return (
        <KpiTile
            label={words.label}
            value={money ? <MoneyText santim={48250075n} unit={words.unit} /> : value}
            delta={delta ? { text: words.delta, direction: delta.direction, sentiment: delta.sentiment } : undefined}
            hint={hint ? words.hint : undefined}
            action={
                withAction ? (
                    <Button variant="link" size="sm" className="h-auto p-0">
                        <T text={TEXT_KPI.viewList} />
                    </Button>
                ) : undefined
            }
            loading={loading}
        />
    );
}

export const Default: Story = {
    render: () => <Demo />
};

/** Rising issued licences are good news. */
export const DeltaUpGood: Story = {
    render: () => <Demo delta={{ text: TEXT_KPI.up, direction: 'up', sentiment: 'good' }} />
};

/** Rising overdue cases are bad news: the arrow shows direction, the colour shows sentiment. */
export const DeltaUpBad: Story = {
    render: () => (
        <Demo label={TEXT_KPI.overdue} value="37" delta={{ text: TEXT_KPI.up, direction: 'up', sentiment: 'bad' }} />
    )
};

export const DeltaDownBad: Story = {
    render: () => <Demo delta={{ text: TEXT_KPI.down, direction: 'down', sentiment: 'bad' }} />
};

export const DeltaDownGood: Story = {
    render: () => (
        <Demo
            label={TEXT_KPI.overdue}
            value="37"
            delta={{ text: TEXT_KPI.down, direction: 'down', sentiment: 'good' }}
        />
    )
};

export const DeltaFlat: Story = {
    render: () => <Demo delta={{ text: TEXT_KPI.flat, direction: 'flat', sentiment: 'neutral' }} />
};

export const WithHintAndAction: Story = {
    render: () => (
        <Demo hint={TEXT_KPI.hint} withAction delta={{ text: TEXT_KPI.up, direction: 'up', sentiment: 'good' }} />
    )
};

export const Money: Story = {
    render: () => (
        <Demo label={TEXT_KPI.revenue} money delta={{ text: TEXT_KPI.up, direction: 'up', sentiment: 'good' }} />
    )
};

export const Loading: Story = {
    render: () => <Demo loading delta={{ text: TEXT_KPI.up, direction: 'up', sentiment: 'good' }} />
};

export const LongText: Story = {
    render: () => (
        <Demo
            label={TEXT.longLabel}
            hint={TEXT.longWoreda}
            delta={{ text: TEXT.longWoreda, direction: 'up', sentiment: 'good' }}
            withAction
        />
    )
};
