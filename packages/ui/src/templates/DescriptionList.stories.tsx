import type { Meta, StoryObj } from '@storybook/react-vite';

import { MoneyText } from '../money/MoneyInput';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { DescriptionList } from './DescriptionList';
import type { DescriptionItem } from './DescriptionList';

const meta = {
    title: 'Templates/DescriptionList',
    component: DescriptionList,
    parameters: { layout: 'padded' },
    // required by the type; every story renders its own state
    args: { items: [] }
} satisfies Meta<typeof DescriptionList>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_DL = {
    birr: { am: 'ብር', en: 'Birr' },
    fee: { am: 'ክፍያ', en: 'Fee' },
    expiry: { am: 'የሚያበቃበት ቀን', en: 'Expiry date' },
    expiryValue: { am: '15 ሐምሌ 2018 ዓ.ም', en: '15 Hamle 2018 E.C.' },
    address: { am: 'አድራሻ', en: 'Address' },
    addressValue: {
        am: 'ደቡብ ኢትዮጵያ ክልል፣ ወላይታ ዞን፣ ሶዶ ዙሪያ ወረዳ፣ ቀበሌ 03፣ ከዋናው መናኸሪያ አጠገብ',
        en: 'South Ethiopia Regional State, Wolaita Zone, Sodo Zuria woreda, kebele 03, next to the main bus terminal'
    },
    emptyNote: { am: 'ማስታወሻ', en: 'Notes' }
} satisfies Record<string, StoryText>;

function useItems(options: { emptyValues?: boolean; wide?: boolean } = {}): DescriptionItem[] {
    const w = useTexts({
        applicant: TEXT.applicantName,
        applicantValue: PEOPLE[0].name,
        plate: TEXT.plateNumber,
        grade: TEXT.licenceGrade,
        woreda: TEXT.woreda,
        woredaValue: TEXT.sodoZuria,
        expiry: TEXT_DL.expiry,
        expiryValue: TEXT_DL.expiryValue,
        fee: TEXT_DL.fee,
        unit: TEXT_DL.birr,
        address: TEXT_DL.address,
        addressValue: TEXT_DL.addressValue,
        notes: TEXT_DL.emptyNote
    });
    const items: DescriptionItem[] = [
        { term: w.applicant, value: w.applicantValue },
        { term: w.plate, value: PEOPLE[0].plate },
        { term: w.grade, value: options.emptyValues ? undefined : 'B' },
        { term: w.woreda, value: w.woredaValue },
        { term: w.expiry, value: options.emptyValues ? '' : w.expiryValue },
        { term: w.fee, value: <MoneyText santim={125050n} unit={w.unit} /> }
    ];
    if (options.wide) items.push({ term: w.address, value: w.addressValue, wide: true });
    if (options.emptyValues) items.push({ term: w.notes, value: undefined, wide: true });
    return items;
}

function Demo({ columns, emptyValues, wide }: { columns?: 1 | 2 | 3; emptyValues?: boolean; wide?: boolean }) {
    const items = useItems({ emptyValues, wide });
    return <DescriptionList items={items} columns={columns} />;
}

export const TwoColumns: Story = {
    render: () => <Demo />
};

export const OneColumn: Story = {
    render: () => <Demo columns={1} />
};

export const ThreeColumns: Story = {
    render: () => <Demo columns={3} />
};

/** Missing values show a dash, never a blank. */
export const EmptyValues: Story = {
    render: () => <Demo emptyValues />
};

/** A `wide` item takes a whole row (an address, a note). */
export const WideItem: Story = {
    render: () => <Demo columns={3} wide />
};

function LongDemo() {
    const w = useTexts({ term: TEXT.longLabel, value: TEXT.longWoreda, other: TEXT.woreda });
    return (
        <div className="max-w-sm">
            <DescriptionList
                columns={2}
                items={[
                    { term: w.term, value: w.value },
                    { term: w.other, value: w.value }
                ]}
            />
        </div>
    );
}

/** Long Amharic terms and values wrap inside their cell. */
export const LongText: Story = {
    render: () => <LongDemo />
};
