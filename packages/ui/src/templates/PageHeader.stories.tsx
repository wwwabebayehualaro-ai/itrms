import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';

import { StatusBadge } from '../controls/StatusBadge';
import { UnitBadge } from '../controls/UnitBadge';
import { Button } from '../primitives/button';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { PageHeader } from './PageHeader';

const meta = {
    title: 'Templates/PageHeader',
    component: PageHeader,
    parameters: { layout: 'padded' },
    // required by the type; every story renders its own state
    args: { title: '' }
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_HEADER = {
    home: { am: 'መነሻ', en: 'Home' },
    licences: { am: 'የመንጃ ፈቃዶች', en: 'Driver licences' },
    licenceTitle: { am: 'የመንጃ ፈቃድ ዕድሳት ማመልከቻ', en: 'Driver licence renewal application' },
    licenceDescription: {
        am: 'የአመልካቹ መረጃ፣ የተያያዙ ሰነዶችና የክፍያ ሁኔታ በዚህ ገጽ ይታያሉ።',
        en: "The applicant's details, attached documents and payment status are shown on this page."
    },
    kind: { am: 'የወረዳ ጽ/ቤት', en: 'Woreda office' },
    category1: { am: 'ምድብ 1', en: 'Category 1' },
    inReview: { am: 'በግምገማ ላይ', en: 'In review' },
    reference: { am: 'ቁጥር፦ DL-2018-004512', en: 'Reference: DL-2018-004512' },
    print: { am: 'አትም', en: 'Print' },
    newRenewal: { am: 'አዲስ ዕድሳት', en: 'New renewal' }
} satisfies Record<string, StoryText>;

function Crumbs() {
    return (
        <ol className="flex flex-wrap items-center gap-2">
            <li>
                <a href="#home" className="underline underline-offset-4">
                    <T text={TEXT_HEADER.home} />
                </a>
            </li>
            <li aria-hidden>/</li>
            <li>
                <a href="#licences" className="underline underline-offset-4">
                    <T text={TEXT_HEADER.licences} />
                </a>
            </li>
        </ol>
    );
}

function Demo({ full, long }: { full?: boolean; long?: boolean }) {
    const words = useTexts({
        title: long ? TEXT.longWoreda : TEXT_HEADER.licenceTitle,
        description: long ? TEXT.longLabel : TEXT_HEADER.licenceDescription,
        inReview: TEXT_HEADER.inReview,
        name: long ? TEXT.longWoreda : TEXT.sodoZuria,
        kind: TEXT_HEADER.kind,
        grade: TEXT_HEADER.category1,
        reference: TEXT_HEADER.reference
    });
    return (
        <PageHeader
            title={words.title}
            description={words.description}
            breadcrumbs={full ? <Crumbs /> : undefined}
            status={full ? <StatusBadge value="in_review" label={words.inReview} tone="progress" /> : undefined}
            meta={
                full ? (
                    <>
                        <UnitBadge name={words.name} kind={words.kind} grade={words.grade} />
                        <span>{words.reference}</span>
                    </>
                ) : undefined
            }
            actions={
                full ? (
                    <>
                        <Button variant="outline">
                            <T text={TEXT_HEADER.print} />
                        </Button>
                        <Button>
                            <Plus aria-hidden />
                            <T text={TEXT_HEADER.newRenewal} />
                        </Button>
                    </>
                ) : undefined
            }
        />
    );
}

export const Default: Story = {
    render: () => <Demo />
};

/** Breadcrumbs, status, key facts and actions together. */
export const Full: Story = {
    render: () => <Demo full />
};

export const TitleOnly: Story = {
    render: () => <PageHeader title={<T text={TEXT.applications} />} />
};

/** A long Amharic title, description and unit name wrap and the actions move under them. */
export const LongText: Story = {
    render: () => (
        <div className="max-w-xl">
            <Demo full long />
        </div>
    )
};
