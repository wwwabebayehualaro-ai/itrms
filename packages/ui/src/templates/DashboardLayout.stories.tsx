import type { Meta, StoryObj } from '@storybook/react-vite';

import { UnitBadge } from '../controls/UnitBadge';
import { MoneyText } from '../money/MoneyInput';
import { Button } from '../primitives/button';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { EmptyState } from './EmptyState';
import { KpiTile } from './KpiTile';
import { DashboardLayout } from './layouts';
import { PageHeader } from './PageHeader';
import { WidgetCard } from './WidgetCard';

const meta = {
    title: 'Templates/Layouts/Dashboard',
    component: DashboardLayout,
    parameters: { layout: 'padded' },
    // required by the type; every story renders its own state
    args: { header: null, children: null }
} satisfies Meta<typeof DashboardLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_DASH = {
    title: { am: 'የመምሪያው ዳሽቦርድ', en: 'Department dashboard' },
    description: { am: 'የዚህ ወር የአገልግሎት ሁኔታ በአጭር።', en: 'The service position for this month at a glance.' },
    kind: { am: 'የወረዳ ጽ/ቤት', en: 'Woreda office' },
    category1: { am: 'ምድብ 1', en: 'Category 1' },
    issued: { am: 'የተሰጡ የመንጃ ፈቃዶች', en: 'Driver licences issued' },
    pending: { am: 'በመጠበቅ ላይ ያሉ ማመልከቻዎች', en: 'Applications waiting' },
    boloDone: { am: 'የተካሄዱ የቦሎ ምርመራዎች', en: 'Bolo inspections done' },
    revenue: { am: 'የዚህ ወር ገቢ', en: 'Revenue this month' },
    birr: { am: 'ብር', en: 'Birr' },
    viewAll: { am: 'ሁሉንም ተመልከት', en: 'View all' },
    recent: { am: 'የቅርብ ጊዜ ማመልከቻዎች', en: 'Recent applications' },
    expiring: { am: 'በቅርቡ የሚያበቁ ቦሎዎች', en: 'Bolos expiring soon' },
    complaints: { am: 'ክፍት ቅሬታዎች', en: 'Open complaints' },
    noComplaints: { am: 'ክፍት ቅሬታ የለም', en: 'There are no open complaints' }
} satisfies Record<string, StoryText>;

function Link() {
    return (
        <Button variant="link" size="sm" className="h-auto p-0">
            <T text={TEXT_DASH.viewAll} />
        </Button>
    );
}

function Demo({ long }: { long?: boolean }) {
    const w = useTexts({
        title: long ? TEXT.longWoreda : TEXT_DASH.title,
        description: long ? TEXT.longLabel : TEXT_DASH.description,
        issued: long ? TEXT.longLabel : TEXT_DASH.issued,
        pending: TEXT_DASH.pending,
        boloDone: TEXT_DASH.boloDone,
        revenue: TEXT_DASH.revenue,
        unit: TEXT_DASH.birr,
        name: TEXT.sodoZuria,
        kind: TEXT_DASH.kind,
        grade: TEXT_DASH.category1,
        recent: TEXT_DASH.recent,
        expiring: TEXT_DASH.expiring,
        complaints: TEXT_DASH.complaints,
        noComplaints: TEXT_DASH.noComplaints,
        p0: PEOPLE[0].name,
        p1: PEOPLE[1].name
    });
    return (
        <DashboardLayout
            header={
                <PageHeader
                    title={w.title}
                    description={w.description}
                    meta={<UnitBadge name={w.name} kind={w.kind} grade={w.grade} />}
                />
            }
            kpis={
                <>
                    <KpiTile
                        label={w.issued}
                        value="1,284"
                        delta={{ text: '+12', direction: 'up', sentiment: 'good' }}
                    />
                    <KpiTile label={w.pending} value="37" delta={{ text: '+5', direction: 'up', sentiment: 'bad' }} />
                    <KpiTile
                        label={w.boloDone}
                        value="412"
                        delta={{ text: '0', direction: 'flat', sentiment: 'neutral' }}
                    />
                    <KpiTile
                        label={w.revenue}
                        value={<MoneyText santim={48250075n} unit={w.unit} />}
                        delta={{ text: '+3%', direction: 'up', sentiment: 'good' }}
                    />
                </>
            }
        >
            <WidgetCard title={w.recent} action={<Link />}>
                <ul className="flex flex-col divide-y">
                    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>{w.p0}</span>
                        <span className="text-muted-foreground">{PEOPLE[0].plate}</span>
                    </li>
                    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>{w.p1}</span>
                        <span className="text-muted-foreground">{PEOPLE[1].plate}</span>
                    </li>
                </ul>
            </WidgetCard>
            <WidgetCard title={w.expiring} action={<Link />} loading />
            <WidgetCard title={w.complaints} action={<Link />}>
                <EmptyState title={w.noComplaints} />
            </WidgetCard>
        </DashboardLayout>
    );
}

export const Default: Story = {
    render: () => <Demo />
};

export const LongText: Story = {
    render: () => <Demo long />
};
