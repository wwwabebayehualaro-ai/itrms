import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TEXT } from '../stories/fixtures';
import { T, useStoryLocale, useText, type StoryText } from '../stories/locale';
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut
} from './command';

const meta = {
    title: 'Primitives/Command',
    component: Command
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

function PaletteDemo({ query }: { query?: StoryText }) {
    const placeholder = useText(TEXT.search);
    const locale = useStoryLocale();
    const [search, setSearch] = useState(query ? (locale === 'am' ? query.am : query.en) : '');
    return (
        <Command className="max-w-sm rounded-lg border" aria-label={placeholder}>
            <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} aria-label={placeholder} />
            <CommandList>
                <CommandEmpty>
                    <T text={TEXT.noResults} />
                </CommandEmpty>
                <CommandGroup heading={useText(TEXT.menu)}>
                    <CommandItem>
                        <T text={TEXT.dashboard} />
                        <CommandShortcut>⌘D</CommandShortcut>
                    </CommandItem>
                    <CommandItem>
                        <T text={TEXT.applications} />
                    </CommandItem>
                    <CommandItem disabled>
                        <T text={TEXT.reports} />
                    </CommandItem>
                </CommandGroup>
                <CommandGroup heading={useText(TEXT.menuAccount)}>
                    <CommandItem>
                        <T text={TEXT.menuSettings} />
                    </CommandItem>
                </CommandGroup>
            </CommandList>
        </Command>
    );
}

export const Default: Story = { render: () => <PaletteDemo /> };

/** A search narrows the list to the matching items. */
export const Filtered: Story = { render: () => <PaletteDemo query={TEXT.applications} /> };

function DialogDemo() {
    const placeholder = useText(TEXT.search);
    const title = useText(TEXT.menu);
    return (
        <CommandDialog open title={title} description={title}>
            <CommandInput placeholder={placeholder} aria-label={placeholder} />
            <CommandList>
                <CommandEmpty>
                    <T text={TEXT.noResults} />
                </CommandEmpty>
                <CommandGroup>
                    <CommandItem>
                        <T text={TEXT.longWoreda} />
                    </CommandItem>
                    <CommandItem>
                        <T text={TEXT.dashboard} />
                    </CommandItem>
                </CommandGroup>
            </CommandList>
        </CommandDialog>
    );
}

/** The command palette in a dialog, with long Amharic text in an item. */
export const InDialog: Story = { render: () => <DialogDemo /> };
