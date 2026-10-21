import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select';
import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import type { StoryText } from '../stories/locale';
import { FilterBar } from './FilterBar';
import type { ActiveFilter } from './FilterBar';

const meta = {
    title: 'Templates/FilterBar',
    component: FilterBar,
    parameters: { layout: 'padded' }
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const TEXT_FILTER = {
    search: { am: 'ፈልግ', en: 'Search' },
    searchPlaceholder: { am: 'በስም ወይም በሰሌዳ ቁጥር ይፈልጉ', en: 'Search by name or plate number' },
    removeFilter: { am: 'ማጣሪያውን አስወግድ፦ {filter}', en: 'Remove filter: {filter}' },
    clearAll: { am: 'ሁሉንም ማጣሪያዎች አጽዳ', en: 'Clear all filters' },
    activeFilters: { am: 'ንቁ ማጣሪያዎች', en: 'Active filters' }
} satisfies Record<string, StoryText>;

const WOREDAS = ['sodoZuria', 'damotGale', 'humbo'] as const;
type WoredaKey = (typeof WOREDAS)[number];

function Demo({
    initialSearch = '',
    initialWoreda = null,
    long
}: {
    initialSearch?: string;
    initialWoreda?: WoredaKey | null;
    long?: boolean;
}) {
    const [search, setSearch] = useState(initialSearch);
    const [woreda, setWoreda] = useState<WoredaKey | null>(initialWoreda);
    const words = useTexts({
        search: TEXT_FILTER.search,
        placeholder: TEXT_FILTER.searchPlaceholder,
        removeFilter: TEXT_FILTER.removeFilter,
        clearAll: TEXT_FILTER.clearAll,
        activeFilters: TEXT_FILTER.activeFilters,
        woreda: TEXT.woreda,
        selectWoreda: TEXT.selectWoreda,
        sodoZuria: long ? TEXT.longWoreda : TEXT.sodoZuria,
        damotGale: TEXT.damotGale,
        humbo: TEXT.humbo
    });
    const active: ActiveFilter[] = [];
    if (search) active.push({ key: 'search', label: `${words.search}: ${search}` });
    if (woreda) active.push({ key: 'woreda', label: `${words.woreda}: ${words[woreda]}` });
    return (
        <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={words.placeholder}
            active={active}
            onRemove={(key) => (key === 'search' ? setSearch('') : setWoreda(null))}
            onClearAll={() => {
                setSearch('');
                setWoreda(null);
            }}
            labels={{
                search: words.search,
                removeFilter: words.removeFilter,
                clearAll: words.clearAll,
                activeFilters: words.activeFilters
            }}
        >
            <Select value={woreda ?? ''} onValueChange={(v) => setWoreda(WOREDAS.find((k) => k === v) ?? null)}>
                <SelectTrigger aria-label={words.woreda} className="w-56">
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
        </FilterBar>
    );
}

export const NoActiveFilters: Story = {
    render: () => <Demo />
};

/** Active filters show as chips, each with its own remove button and a clear-all link. */
export const ActiveFilters: Story = {
    render: () => <Demo initialSearch="ኢት-ሀለመ" initialWoreda="damotGale" />
};

export const LongText: Story = {
    render: () => (
        <div className="max-w-md">
            <Demo initialWoreda="sodoZuria" long />
        </div>
    )
};
