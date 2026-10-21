import type { Meta, StoryObj } from '@storybook/react-vite';

import { MoneyText } from '../money/MoneyInput';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { DescriptionList } from './DescriptionList';
import { PrintLayout } from './PrintLayout';

const meta = {
    title: 'Templates/Layouts/Print',
    component: PrintLayout,
    parameters: { layout: 'fullscreen' },
    // required by the type; every story renders its own state
    args: { letterhead: null, title: '' }
} satisfies Meta<typeof PrintLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_PRINT = {
    bureau: { am: 'ናሙና ክልላዊ ቢሮ', en: 'Sample Regional Bureau' },
    bureauSub: { am: 'የትራንስፖርትና የመንገድ ልማት ጽ/ቤት', en: 'Transport and Road Development Office' },
    title: { am: 'የክፍያ ደረሰኝ', en: 'Payment receipt' },
    number: { am: 'የደረሰኝ ቁጥር፦ RC-2018-000731', en: 'Receipt number: RC-2018-000731' },
    date: { am: 'ቀን፦ 12 ሐምሌ 2018 ዓ.ም', en: 'Date: 12 Hamle 2018 E.C.' },
    qr: { am: 'የማረጋገጫ QR ኮድ', en: 'Verification QR code' },
    payer: { am: 'ከፋይ', en: 'Payer' },
    renewal: { am: 'የመንጃ ፈቃድ ዕድሳት', en: 'Driver licence renewal' },
    bolo: { am: 'የቦሎ ምርመራ', en: 'Bolo inspection' },
    service: { am: 'የአገልግሎት ክፍያ', en: 'Service charge' },
    total: { am: 'ጠቅላላ የተከፈለ', en: 'Total paid' },
    birr: { am: 'ብር', en: 'Birr' },
    cashier: { am: 'የገንዘብ ተቀባይ ፊርማ', en: "Cashier's signature" },
    stamp: { am: 'የማኅተም ቦታ', en: 'Stamp area' }
} satisfies Record<string, StoryText>;

function Demo({ long }: { long?: boolean }) {
    const w = useTexts({
        bureau: TEXT_PRINT.bureau,
        bureauSub: long ? TEXT.longWoreda : TEXT_PRINT.bureauSub,
        title: TEXT_PRINT.title,
        number: TEXT_PRINT.number,
        date: TEXT_PRINT.date,
        qr: TEXT_PRINT.qr,
        payer: TEXT_PRINT.payer,
        payerName: PEOPLE[0].name,
        renewal: long ? TEXT.longLabel : TEXT_PRINT.renewal,
        bolo: TEXT_PRINT.bolo,
        service: TEXT_PRINT.service,
        total: TEXT_PRINT.total,
        unit: TEXT_PRINT.birr,
        cashier: TEXT_PRINT.cashier,
        stamp: TEXT_PRINT.stamp,
        plate: TEXT.plateNumber
    });
    return (
        <PrintLayout
            letterhead={
                <div className="flex flex-col gap-0.5">
                    <p className="text-lg font-semibold">{w.bureau}</p>
                    <p className="text-muted-foreground">{w.bureauSub}</p>
                </div>
            }
            title={w.title}
            meta={
                <>
                    <p>{w.number}</p>
                    <p>{w.date}</p>
                </>
            }
            qr={
                <div
                    role="img"
                    aria-label={w.qr}
                    className="flex size-24 items-center justify-center border-2 p-1 text-center text-sm text-muted-foreground"
                >
                    {w.qr}
                </div>
            }
            footer={
                <div className="flex flex-wrap items-end justify-between gap-6">
                    <p className="min-w-48 border-t pt-1">{w.cashier}</p>
                    <p className="flex h-20 min-w-32 items-center justify-center border border-dashed px-4 text-muted-foreground">
                        {w.stamp}
                    </p>
                </div>
            }
        >
            <DescriptionList
                columns={1}
                items={[
                    { term: w.payer, value: w.payerName },
                    { term: w.plate, value: PEOPLE[0].plate },
                    { term: w.renewal, value: <MoneyText santim={125050n} unit={w.unit} /> },
                    { term: w.bolo, value: <MoneyText santim={80000n} unit={w.unit} /> },
                    { term: w.service, value: <MoneyText santim={2500n} unit={w.unit} /> },
                    { term: w.total, value: <MoneyText santim={207550n} unit={w.unit} className="font-semibold" /> }
                ]}
            />
        </PrintLayout>
    );
}

export const Receipt: Story = {
    render: () => <Demo />
};

export const LongText: Story = {
    render: () => <Demo long />
};
