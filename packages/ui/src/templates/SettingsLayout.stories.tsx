import type { Meta, StoryObj } from '@storybook/react-vite';
import { useId, useState } from 'react';

import { MoneyInput } from '../money/MoneyInput';
import { Input } from '../primitives/input';
import { Switch } from '../primitives/switch';
import { TEXT } from '../stories/fixtures';
import { T, useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { SettingRow, SettingsLayout, SettingsSection } from './layouts';
import { PageHeader } from './PageHeader';

const meta = {
    title: 'Templates/Layouts/Settings',
    component: SettingsLayout,
    parameters: { layout: 'padded' },
    // required by the type; every story renders its own state
    args: { header: null, children: null }
} satisfies Meta<typeof SettingsLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_SET = {
    title: { am: 'የአገልግሎት ቅንብሮች', en: 'Service settings' },
    description: {
        am: 'ከክልሉ የሚወርሱ ቅንብሮች እና በዚህ ጽ/ቤት የተለወጡት።',
        en: 'Settings inherited from the region and the ones changed by this office.'
    },
    navGeneral: { am: 'አጠቃላይ', en: 'General' },
    navFees: { am: 'ክፍያዎችና ማሳሰቢያዎች', en: 'Fees and reminders' },
    general: { am: 'አጠቃላይ ቅንብሮች', en: 'General settings' },
    generalHelp: { am: 'የጽ/ቤቱ መሠረታዊ ቅንብሮች።', en: 'The basic settings of the office.' },
    fees: { am: 'የክፍያና የማሳሰቢያ ቅንብሮች', en: 'Fee and reminder settings' },
    officeName: { am: 'የጽ/ቤቱ ማሳያ ስም', en: 'Office display name' },
    officeNameHelp: { am: 'በደረሰኞችና በሰነዶች ራስጌ ላይ ይታያል።', en: 'Shown in the header of receipts and documents.' },
    officeNameValue: { am: 'ሶዶ ዙሪያ ወረዳ ጽ/ቤት', en: 'Sodo Zuria woreda office' },
    sms: { am: 'የኤስኤምኤስ ማሳወቂያ', en: 'SMS notifications' },
    smsHelp: { am: 'ለአመልካቾች የሁኔታ ለውጥ መልእክት ይላካል።', en: 'Applicants receive a message when a status changes.' },
    renewalFee: { am: 'የመንጃ ፈቃድ ዕድሳት ማሳሰቢያ (ቀናት)', en: 'Licence renewal reminder (days)' },
    renewalFeeHelp: {
        am: 'ዞኑ እስካልለወጠው ድረስ የክልሉ ተመን ይሠራል።',
        en: 'The regional rate applies unless the zone changes it.'
    },
    fromRegion: { am: 'ከክልሉ የተወረሰ', en: 'From the region' },
    setHere: { am: 'እዚህ የተቀመጠ', en: 'Set here' },
    reset: { am: 'ወደ ተወረሰው እሴት መልስ', en: 'Reset to the inherited value' },
    renewalCharge: { am: 'የመንጃ ፈቃድ ዕድሳት ክፍያ', en: 'Licence renewal fee' },
    renewalChargeHelp: {
        am: 'ይህ ጽ/ቤት ከክልሉ ተመን የተለየ ክፍያ አስቀምጧል።',
        en: 'This office set its own fee instead of the regional one.'
    },
    birr: { am: 'ብር', en: 'Birr' }
} satisfies Record<string, StoryText>;

function Demo({ long }: { long?: boolean }) {
    const ids = { name: useId(), sms: useId(), fee: useId(), charge: useId() };
    const regionName = TEXT_SET.officeNameValue;
    const w = useTexts({
        title: TEXT_SET.title,
        description: TEXT_SET.description,
        officeName: long ? TEXT.longLabel : TEXT_SET.officeName,
        officeNameHelp: long ? TEXT.longWoreda : TEXT_SET.officeNameHelp,
        officeNameValue: regionName,
        sms: TEXT_SET.sms,
        smsHelp: TEXT_SET.smsHelp,
        renewalFee: TEXT_SET.renewalFee,
        renewalFeeHelp: TEXT_SET.renewalFeeHelp,
        fromRegion: TEXT_SET.fromRegion,
        setHere: TEXT_SET.setHere,
        reset: TEXT_SET.reset,
        renewalCharge: TEXT_SET.renewalCharge,
        renewalChargeHelp: TEXT_SET.renewalChargeHelp,
        birr: TEXT_SET.birr
    });
    const inheritedName = w.officeNameValue;
    // null: the office has not set its own name, so the inherited one (in the active language) shows
    const [ownName, setOwnName] = useState<string | null>(null);
    const [sms, setSms] = useState(true);
    const [fee, setFee] = useState('60');
    const inheritedFee = '30';
    const inheritedCharge = 12000n;
    const [charge, setCharge] = useState<bigint | null>(15000n);
    const nameOverridden = ownName !== null;
    const feeOverridden = fee !== inheritedFee;
    return (
        <SettingsLayout
            header={<PageHeader title={w.title} description={w.description} />}
            nav={
                <ul className="flex flex-col gap-1">
                    <li>
                        <a href="#general" className="underline underline-offset-4">
                            <T text={TEXT_SET.navGeneral} />
                        </a>
                    </li>
                    <li>
                        <a href="#fees" className="underline underline-offset-4">
                            <T text={TEXT_SET.navFees} />
                        </a>
                    </li>
                </ul>
            }
        >
            <SettingsSection title={<T text={TEXT_SET.general} />} description={<T text={TEXT_SET.generalHelp} />}>
                <SettingRow
                    label={w.officeName}
                    description={w.officeNameHelp}
                    controlId={ids.name}
                    control={
                        <Input
                            id={ids.name}
                            value={ownName ?? inheritedName}
                            onChange={(e) => setOwnName(e.target.value)}
                        />
                    }
                    source={nameOverridden ? w.setHere : w.fromRegion}
                    overridden={nameOverridden}
                    onReset={() => setOwnName(null)}
                    resetLabel={w.reset}
                />
                <SettingRow
                    label={w.sms}
                    description={w.smsHelp}
                    controlId={ids.sms}
                    control={<Switch id={ids.sms} checked={sms} onCheckedChange={setSms} />}
                    source={w.fromRegion}
                />
            </SettingsSection>
            <SettingsSection title={<T text={TEXT_SET.fees} />}>
                <SettingRow
                    label={w.renewalFee}
                    description={w.renewalFeeHelp}
                    controlId={ids.fee}
                    control={
                        <Input id={ids.fee} inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} />
                    }
                    source={feeOverridden ? w.setHere : w.fromRegion}
                    overridden={feeOverridden}
                    onReset={() => setFee(inheritedFee)}
                    resetLabel={w.reset}
                />
                <SettingRow
                    label={w.renewalCharge}
                    description={w.renewalChargeHelp}
                    controlId={ids.charge}
                    control={<MoneyInput id={ids.charge} unit={w.birr} value={charge} onValueChange={setCharge} />}
                    source={charge !== inheritedCharge ? w.setHere : w.fromRegion}
                    overridden={charge !== inheritedCharge}
                    onReset={() => setCharge(inheritedCharge)}
                    resetLabel={w.reset}
                />
            </SettingsSection>
        </SettingsLayout>
    );
}

/** The office name is inherited; the reminder is overridden here and can be reset. Edit a value to see the source change. */
export const Default: Story = {
    render: () => <Demo />
};

export const LongText: Story = {
    render: () => <Demo long />
};
