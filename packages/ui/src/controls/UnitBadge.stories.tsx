import type { Meta, StoryObj } from '@storybook/react-vite';
import { Truck } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { UnitBadge } from './UnitBadge';

const meta = {
    title: 'Controls/UnitBadge',
    component: UnitBadge,
    // required by the type; every story renders its own state
    args: { name: '', kind: '' }
} satisfies Meta<typeof UnitBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_UNIT = {
    woredaOffice: { am: 'የወረዳ ጽ/ቤት', en: 'Woreda office' },
    zoneDepartment: { am: 'የዞን መምሪያ', en: 'Zone department' },
    town: { am: 'ከተማ አስተዳደር', en: 'Town administration' },
    category1: { am: 'ምድብ 1', en: 'Category 1' },
    grade2: { am: 'ፈርጅ 2', en: 'Grade 2' },
    soddo: { am: 'ሶዶ', en: 'Sodo' }
} satisfies Record<string, StoryText>;

function Demo({
    name,
    kind,
    grade,
    withIcon
}: {
    name: StoryText;
    kind: StoryText;
    grade?: StoryText;
    withIcon?: boolean;
}) {
    const words = useTexts({ name, kind, grade: grade ?? kind });
    return (
        <UnitBadge
            name={words.name}
            kind={words.kind}
            grade={grade ? words.grade : undefined}
            icon={withIcon ? <Truck className="size-4" /> : undefined}
        />
    );
}

export const Default: Story = {
    render: () => <Demo name={TEXT.sodoZuria} kind={TEXT_UNIT.woredaOffice} />
};

export const WithGrade: Story = {
    render: () => <Demo name={TEXT.sodoZuria} kind={TEXT_UNIT.woredaOffice} grade={TEXT_UNIT.category1} />
};

export const TownWithGrade: Story = {
    render: () => <Demo name={TEXT_UNIT.soddo} kind={TEXT_UNIT.town} grade={TEXT_UNIT.grade2} />
};

export const ZoneDepartment: Story = {
    render: () => <Demo name={TEXT.damotGale} kind={TEXT_UNIT.zoneDepartment} />
};

export const CustomIcon: Story = {
    render: () => <Demo name={TEXT.humbo} kind={TEXT_UNIT.woredaOffice} grade={TEXT_UNIT.category1} withIcon />
};

/** A long unit name wraps inside the badge. */
export const LongText: Story = {
    render: () => (
        <div className="w-64">
            <Demo name={TEXT.longWoreda} kind={TEXT_UNIT.woredaOffice} grade={TEXT_UNIT.category1} />
        </div>
    )
};
