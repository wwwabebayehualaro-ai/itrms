import type { Meta, StoryObj } from '@storybook/react-vite';
import { useId, useState } from 'react';

import { MoneyInput, MoneyText } from '../money/MoneyInput';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import { Label } from '../primitives/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select';
import { TEXT } from '../stories/fixtures';
import { T, useText, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { FormLayout } from './layouts';
import { PageHeader } from './PageHeader';

const meta = {
    title: 'Templates/Layouts/Form',
    component: FormLayout,
    parameters: { layout: 'fullscreen' },
    // required by the type; every story renders its own state
    args: { header: null, actions: null, children: null }
} satisfies Meta<typeof FormLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_FORM = {
    draftSaved: { am: 'ረቂቅ ተቀምጧል', en: 'Draft saved' },
    saveDraft: { am: 'ረቂቅ አስቀምጥ', en: 'Save draft' },
    fee: { am: 'የዕድሳት ክፍያ', en: 'Renewal fee' },
    summary: { am: 'የክፍያ ማጠቃለያ', en: 'Fee summary' },
    base: { am: 'መሠረታዊ ክፍያ', en: 'Base fee' },
    service: { am: 'የአገልግሎት ክፍያ', en: 'Service charge' },
    total: { am: 'ጠቅላላ', en: 'Total' },
    birr: { am: 'ብር', en: 'Birr' }
} satisfies Record<string, StoryText>;

const WOREDAS = ['sodoZuria', 'damotGale', 'humbo'] as const;

function FeeSummary({ fee }: { fee: bigint | null }) {
    const unit = useText(TEXT_FORM.birr);
    const base = fee ?? 0n;
    const service = 2500n;
    return (
        <section aria-labelledby="fee-summary" className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <h2 id="fee-summary" className="text-base font-semibold">
                <T text={TEXT_FORM.summary} />
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>
                    <T text={TEXT_FORM.base} />
                </dt>
                <dd className="text-end">
                    <MoneyText santim={base} unit={unit} />
                </dd>
                <dt>
                    <T text={TEXT_FORM.service} />
                </dt>
                <dd className="text-end">
                    <MoneyText santim={service} unit={unit} />
                </dd>
                <dt className="font-medium">
                    <T text={TEXT_FORM.total} />
                </dt>
                <dd className="text-end font-medium">
                    <MoneyText santim={base + service} unit={unit} />
                </dd>
            </dl>
        </section>
    );
}

function Demo({ long }: { long?: boolean }) {
    const [fee, setFee] = useState<bigint | null>(125050n);
    const ids = { name: useId(), plate: useId(), woreda: useId(), fee: useId() };
    const words = useTexts({
        title: long ? TEXT.longWoreda : TEXT.newApplication,
        description: long ? TEXT.longLabel : TEXT.applicationHelp,
        name: long ? TEXT.longLabel : TEXT.applicantName,
        plate: TEXT.plateNumber,
        woreda: TEXT.woreda,
        selectWoreda: TEXT.selectWoreda,
        sodoZuria: TEXT.sodoZuria,
        damotGale: TEXT.damotGale,
        humbo: TEXT.humbo,
        unit: TEXT_FORM.birr
    });
    return (
        <form onSubmit={(e) => e.preventDefault()} className="p-4">
            <FormLayout
                header={<PageHeader title={words.title} description={words.description} />}
                status={<T text={TEXT_FORM.draftSaved} />}
                actions={
                    <>
                        <Button type="button" variant="outline">
                            <T text={TEXT_FORM.saveDraft} />
                        </Button>
                        <Button type="submit">
                            <T text={TEXT.submit} />
                        </Button>
                    </>
                }
                aside={<FeeSummary fee={fee} />}
            >
                <div className="flex flex-col gap-2">
                    <Label htmlFor={ids.name}>{words.name}</Label>
                    <Input id={ids.name} />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={ids.plate}>
                        <T text={TEXT.plateNumber} />
                    </Label>
                    <Input id={ids.plate} defaultValue="ኢት-ሀለመ-1234" />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={ids.woreda}>
                        <T text={TEXT.woreda} />
                    </Label>
                    <Select>
                        <SelectTrigger id={ids.woreda} className="w-full">
                            <SelectValue placeholder={words.selectWoreda} />
                        </SelectTrigger>
                        <SelectContent>
                            {WOREDAS.map((k) => (
                                <SelectItem key={k} value={k}>
                                    {words[k]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={ids.fee}>
                        <T text={TEXT_FORM.fee} />
                    </Label>
                    <MoneyInput id={ids.fee} value={fee} onValueChange={setFee} unit={words.unit} />
                </div>
            </FormLayout>
        </form>
    );
}

export const Default: Story = {
    render: () => <Demo />
};

/** A long Amharic title, description and label wrap without breaking the layout. */
export const LongText: Story = {
    render: () => <Demo long />
};
