/**
 * Whole pages built only from the templates (the "Done when" of task 0.4c): a list page and a record page. Modules build
 * their screens the same way, from these parts and the DataGrid, without layout code of their own.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { PersonName } from '../controls/PersonName';
import { StatusBadge } from '../controls/StatusBadge';
import { UnitBadge } from '../controls/UnitBadge';
import { DataGrid } from '../data/DataGrid';
import { MoneyText } from '../money/MoneyInput';
import { Button } from '../primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select';
import { PEOPLE, TEXT } from '../stories/fixtures';
import { T, useText, useTexts, type StoryText } from '../stories/locale';
import { DescriptionList } from './DescriptionList';
import { EmptyState } from './EmptyState';
import { FilterBar } from './FilterBar';
import { ListLayout, RecordLayout } from './layouts';
import { PageHeader } from './PageHeader';
import { WidgetCard } from './WidgetCard';

const meta = {
    title: 'Templates/Pages',
    parameters: { layout: 'padded' }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const WORDS = {
    licenceApplications: { am: 'የመንጃ ፈቃድ ማመልከቻዎች', en: 'Driver licence applications' },
    listHelp: {
        am: 'በዚህ ክፍል የቀረቡ ማመልከቻዎች። በወረዳ ወይም በሁኔታ ያጣሩ።',
        en: 'Applications submitted to this unit. Filter them by woreda or status.'
    },
    searchPlaceholder: { am: 'በስም ወይም በማመልከቻ ቁጥር ይፈልጉ', en: 'Search by name or application number' },
    applicationNo: { am: 'የማመልከቻ ቁጥር', en: 'Application number' },
    applicant: { am: 'አመልካች', en: 'Applicant' },
    grade: { am: 'ደረጃ', en: 'Grade' },
    woredaFilter: { am: 'ወረዳ፦ ሶዶ ዙሪያ', en: 'Woreda: Sodo Zuria' },
    statusFilter: { am: 'ሁኔታ፦ በመጠበቅ ላይ', en: 'Status: Pending' },
    allWoredas: { am: 'ሁሉም ወረዳዎች', en: 'All woredas' },
    noMatchTitle: { am: 'ከማጣሪያው ጋር የሚመሳሰል ማመልከቻ የለም', en: 'No application matches these filters' },
    noMatchHelp: {
        am: 'ማጣሪያዎቹን ያስወግዱ ወይም ሌላ ቃል ይፈልጉ።',
        en: 'Remove a filter or search for another word.'
    },
    clearFilters: { am: 'ማጣሪያዎችን አጽዳ', en: 'Clear the filters' },
    removeFilter: { am: 'ማጣሪያውን አስወግድ፦ {filter}', en: 'Remove the filter: {filter}' },
    activeFilters: { am: 'የተመረጡ ማጣሪያዎች', en: 'Active filters' },
    licence: { am: 'የመንጃ ፈቃድ', en: 'Driver licence' },
    licenceNo: { am: 'የፈቃድ ቁጥር', en: 'Licence number' },
    valid: { am: 'የሚሰራ', en: 'Valid' },
    renew: { am: 'አድስ', en: 'Renew' },
    issued: { am: 'የተሰጠበት ቀን', en: 'Issued on' },
    expires: { am: 'የሚያበቃበት ቀን', en: 'Expires on' },
    birthPlace: { am: 'የትውልድ ቦታ', en: 'Place of birth' },
    address: { am: 'አድራሻ', en: 'Address' },
    addressValue: {
        am: 'ወላይታ ዞን፣ ሶዶ ዙሪያ ወረዳ፣ ቀበሌ 04',
        en: 'Wolaita Zone, Sodo Zuria woreda, kebele 04'
    },
    overview: { am: 'አጠቃላይ', en: 'Overview' },
    documents: { am: 'ሰነዶች', en: 'Documents' },
    payments: { am: 'ክፍያዎች', en: 'Payments' },
    noDocuments: { am: 'እስካሁን ሰነድ አልተያያዘም', en: 'No documents are attached yet' },
    noDocumentsHelp: {
        am: 'የምርመራ ውጤትና የሕክምና ማስረጃ ሲያያዝ እዚህ ይታያል።',
        en: 'The test result and the medical certificate appear here once attached.'
    },
    history: { am: 'ታሪክ', en: 'History' },
    historyIssued: { am: 'ፈቃዱ ተሰጠ', en: 'Licence issued' },
    historyPaid: { am: 'ክፍያ ተፈጽሟል', en: 'Fee paid' },
    historySubmitted: { am: 'ማመልከቻ ቀረበ', en: 'Application submitted' },
    receipt: { am: 'ደረሰኝ', en: 'Receipt' },
    amount: { am: 'መጠን', en: 'Amount' },
    birr: { am: 'ብር', en: 'Birr' },
    woredaOffice: { am: 'የወረዳ ጽ/ቤት', en: 'Woreda office' },
    category1: { am: 'ምድብ 1', en: 'Category 1' },
    gradeAuto: { am: 'ደረቅ 1', en: 'Dry 1' }
} satisfies Record<string, StoryText>;

interface Application {
    id: string;
    applicant: StoryText;
    woreda: StoryText;
    approved: boolean;
}

const APPLICATIONS: Application[] = PEOPLE.map((p, i) => ({
    id: `ML/${String(120 + i).padStart(6, '0')}/2019`,
    applicant: p.name,
    woreda: [TEXT.sodoZuria, TEXT.damotGale, TEXT.humbo][i] ?? TEXT.sodoZuria,
    approved: i === 0
}));

function ApplicationsPage({ empty = false }: { empty?: boolean }) {
    const w = useTexts({
        title: WORDS.licenceApplications,
        help: WORDS.listHelp,
        newApplication: TEXT.newApplication,
        search: TEXT.search,
        placeholder: WORDS.searchPlaceholder,
        number: WORDS.applicationNo,
        applicant: WORDS.applicant,
        woreda: TEXT.woreda,
        status: TEXT.status,
        approved: TEXT.approved,
        pending: TEXT.pending,
        woredaFilter: WORDS.woredaFilter,
        statusFilter: WORDS.statusFilter,
        all: WORDS.allWoredas,
        clear: WORDS.clearFilters,
        remove: WORDS.removeFilter,
        activeFilters: WORDS.activeFilters,
        caption: WORDS.licenceApplications,
        sodo: TEXT.sodoZuria,
        damot: TEXT.damotGale
    });
    const [search, setSearch] = useState('');
    const [active, setActive] = useState(
        empty
            ? [
                  { key: 'woreda', label: w.woredaFilter },
                  { key: 'status', label: w.statusFilter }
              ]
            : []
    );
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    const [sorting, setSorting] = useState<SortingState>([{ id: 'id', desc: false }]);
    const columns: ColumnDef<Application, unknown>[] = [
        { accessorKey: 'id', header: w.number },
        { id: 'applicant', header: w.applicant, cell: ({ row }) => <T text={row.original.applicant} /> },
        { id: 'woreda', header: w.woreda, cell: ({ row }) => <T text={row.original.woreda} /> },
        {
            id: 'status',
            header: w.status,
            enableSorting: false,
            cell: ({ row }) => (
                <StatusBadge
                    value={row.original.approved ? 'approved' : 'pending'}
                    label={row.original.approved ? w.approved : w.pending}
                    tone={row.original.approved ? 'success' : 'warning'}
                />
            )
        }
    ];
    return (
        <ListLayout
            header={
                <PageHeader
                    title={w.title}
                    description={w.help}
                    actions={
                        <Button>
                            <Plus aria-hidden />
                            {w.newApplication}
                        </Button>
                    }
                />
            }
            filters={
                <FilterBar
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder={w.placeholder}
                    active={active}
                    onRemove={(key) => setActive((a) => a.filter((f) => f.key !== key))}
                    onClearAll={() => setActive([])}
                    labels={{
                        search: w.search,
                        removeFilter: w.remove,
                        clearAll: w.clear,
                        activeFilters: w.activeFilters
                    }}
                >
                    <Select defaultValue="all">
                        <SelectTrigger aria-label={w.woreda} className="w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{w.all}</SelectItem>
                            <SelectItem value="sodo">{w.sodo}</SelectItem>
                            <SelectItem value="damot">{w.damot}</SelectItem>
                        </SelectContent>
                    </Select>
                </FilterBar>
            }
        >
            {empty ? (
                <NoMatch onClear={() => setActive([])} />
            ) : (
                <DataGrid
                    data={APPLICATIONS}
                    columns={columns}
                    total={APPLICATIONS.length}
                    pagination={pagination}
                    onPaginationChange={setPagination}
                    sorting={sorting}
                    onSortingChange={setSorting}
                    getRowId={(a) => a.id}
                    caption={w.caption}
                />
            )}
        </ListLayout>
    );
}

function NoMatch({ onClear }: { onClear: () => void }) {
    const w = useTexts({ title: WORDS.noMatchTitle, help: WORDS.noMatchHelp, clear: WORDS.clearFilters });
    return (
        <EmptyState
            variant="no-results"
            title={w.title}
            description={w.help}
            action={
                <Button variant="outline" onClick={onClear}>
                    {w.clear}
                </Button>
            }
        />
    );
}

/** A list page: header with the primary action, filters, then the grid. */
export const ListPage: Story = {
    render: () => <ApplicationsPage />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        await expect(canvas.getByRole('search')).toBeInTheDocument();
        await expect(canvas.getAllByRole('row')).toHaveLength(APPLICATIONS.length + 1);
    }
};

/** The same page when the filters hide everything: the empty state says why and offers the way out. */
export const ListPageNoResults: Story = {
    render: () => <ApplicationsPage empty />
};

const [person] = PEOPLE;
const split = (name: string) => {
    const [given = '', father = '', grandfather] = name.split(' ');
    return { given, father, grandfather };
};

function LicenceRecordPage() {
    const w = useTexts({
        licence: WORDS.licence,
        valid: WORDS.valid,
        renew: WORDS.renew,
        edit: TEXT.edit,
        number: WORDS.licenceNo,
        grade: TEXT.licenceGrade,
        gradeValue: WORDS.gradeAuto,
        issued: WORDS.issued,
        expires: WORDS.expires,
        birthPlace: WORDS.birthPlace,
        address: WORDS.address,
        addressValue: WORDS.addressValue,
        phone: TEXT.phone,
        overview: WORDS.overview,
        documents: WORDS.documents,
        payments: WORDS.payments,
        noDocuments: WORDS.noDocuments,
        noDocumentsHelp: WORDS.noDocumentsHelp,
        history: WORDS.history,
        historyIssued: WORDS.historyIssued,
        historyPaid: WORDS.historyPaid,
        historySubmitted: WORDS.historySubmitted,
        receipt: WORDS.receipt,
        amount: WORDS.amount,
        birr: WORDS.birr,
        office: WORDS.woredaOffice,
        category: WORDS.category1,
        sodo: TEXT.sodoZuria,
        caption: WORDS.payments
    });
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
    const payments = [
        { receipt: 'RC/000412/2019', santim: 35000n },
        { receipt: 'RC/000587/2019', santim: 12550n }
    ];
    const paymentColumns: ColumnDef<(typeof payments)[number], unknown>[] = [
        { accessorKey: 'receipt', header: w.receipt },
        {
            id: 'amount',
            header: w.amount,
            cell: ({ row }) => <MoneyText santim={row.original.santim} unit={w.birr} />
        }
    ];
    const name = person && (
        <PersonName ethiopic={split(person.name.am)} latin={split(person.name.en)} script="ethiopic" />
    );
    const nameText = useText(person?.name ?? TEXT.applicantName);
    return (
        <RecordLayout
            header={
                <PageHeader
                    title={name ?? nameText}
                    status={<StatusBadge value="valid" label={w.valid} tone="success" />}
                    meta={
                        <>
                            <UnitBadge name={w.sodo} kind={w.office} grade={w.category} />
                            <span className="text-muted-foreground">{w.licence} · 04-112-2019</span>
                        </>
                    }
                    actions={
                        <>
                            <Button variant="outline">{w.edit}</Button>
                            <Button>
                                <RefreshCw aria-hidden />
                                {w.renew}
                            </Button>
                        </>
                    }
                />
            }
            summary={
                <DescriptionList
                    columns={3}
                    items={[
                        { term: w.number, value: '04-112-2019' },
                        { term: w.grade, value: w.gradeValue },
                        { term: w.issued, value: '2019-02-14' },
                        { term: w.expires, value: '2023-02-13' },
                        { term: w.phone, value: '' },
                        { term: w.address, value: w.addressValue, wide: true }
                    ]}
                />
            }
            tabs={[
                {
                    value: 'overview',
                    label: w.overview,
                    content: (
                        <DescriptionList
                            items={[
                                { term: w.birthPlace, value: w.sodo },
                                { term: w.address, value: w.addressValue }
                            ]}
                        />
                    )
                },
                {
                    value: 'documents',
                    label: w.documents,
                    content: <EmptyState title={w.noDocuments} description={w.noDocumentsHelp} />
                },
                {
                    value: 'payments',
                    label: w.payments,
                    content: (
                        <DataGrid
                            data={payments}
                            columns={paymentColumns}
                            total={payments.length}
                            pagination={pagination}
                            onPaginationChange={setPagination}
                            getRowId={(p) => p.receipt}
                            caption={w.caption}
                        />
                    )
                }
            ]}
            aside={
                <WidgetCard title={w.history}>
                    <ol className="flex flex-col gap-3 text-sm">
                        <li>
                            <p className="font-medium">{w.historyIssued}</p>
                            <p className="text-muted-foreground">2019-02-14</p>
                        </li>
                        <li>
                            <p className="font-medium">{w.historyPaid}</p>
                            <p className="text-muted-foreground">2019-02-10</p>
                        </li>
                        <li>
                            <p className="font-medium">{w.historySubmitted}</p>
                            <p className="text-muted-foreground">2019-02-03</p>
                        </li>
                    </ol>
                </WidgetCard>
            }
        />
    );
}

/** A record page: the person's name in their script, status and unit in the header, key facts, tabs and history. */
export const RecordPage: Story = {
    render: () => <LicenceRecordPage />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        const tabs = canvas.getAllByRole('tab');
        await expect(tabs).toHaveLength(3);
        const payments = tabs[2];
        if (!payments) throw new Error('no payments tab');
        await userEvent.click(payments);
        await expect(payments).toHaveAttribute('aria-selected', 'true');
        await expect(canvas.getByRole('table')).toBeInTheDocument();
        // back to the overview, so the picture shows the record's first tab
        const overview = tabs[0];
        if (overview) await userEvent.click(overview);
    }
};
