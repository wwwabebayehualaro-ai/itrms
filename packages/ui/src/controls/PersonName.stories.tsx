import type { Meta, StoryObj } from '@storybook/react-vite';

import { PersonName } from './PersonName';
import type { PersonNameParts } from './PersonName';

const meta = {
    title: 'Controls/PersonName',
    component: PersonName
} satisfies Meta<typeof PersonName>;

export default meta;
type Story = StoryObj<typeof meta>;

// Generated sample names (never real people), split as the bureaus write them: given, father and grandfather.
const ABEBE_AM: PersonNameParts = { given: 'አበበ', father: 'ከበደ', grandfather: 'ጫላ' };
const ABEBE_EN: PersonNameParts = { given: 'Abebe', father: 'Kebede', grandfather: 'Chala' };
const LONG_AM: PersonNameParts = { given: 'ትዕግስት', father: 'ወንድምአገኝ', grandfather: 'ገብረሥላሴ' };
const LONG_EN: PersonNameParts = { given: 'Tigist', father: 'Wondimagegn', grandfather: 'Gebreselassie' };

export const EthiopicOnly: Story = {
    args: { ethiopic: ABEBE_AM }
};

export const LatinOnly: Story = {
    args: { latin: ABEBE_EN }
};

/** Fayda and passports carry both spellings; the other follows in brackets. */
export const Both: Story = {
    args: { ethiopic: ABEBE_AM, latin: ABEBE_EN, both: true }
};

/** Lists and greetings use the given and father names only. */
export const Short: Story = {
    args: { ethiopic: ABEBE_AM, latin: ABEBE_EN, both: true, form: 'short' }
};

export const LatinLeading: Story = {
    args: { ethiopic: ABEBE_AM, latin: ABEBE_EN, both: true, script: 'latin' }
};

export const LongName: Story = {
    args: { ethiopic: LONG_AM, latin: LONG_EN, both: true },
    decorators: [
        (Story) => (
            <div className="w-40 border p-2">
                <Story />
            </div>
        )
    ]
};
