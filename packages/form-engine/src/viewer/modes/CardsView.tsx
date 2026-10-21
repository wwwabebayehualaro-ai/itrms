'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import {
    IconButton,
    InlineStatus,
    Pager,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    cn
} from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { useSubmissionData } from '../api';
import { EmptyBox, RecordCard } from '../components';
import type { ViewModeProps } from '../registry';

const PAGE_SIZES = [12, 24, 48];

export default function CardsView({
    templateId,
    schema,
    state,
    patch,
    labeler,
    onOpen,
    rowActions,
    emptyMessage
}: ViewModeProps) {
    const pageSize = PAGE_SIZES.includes(state.pageSize) ? state.pageSize : (PAGE_SIZES[0] ?? state.pageSize);
    const sort = state.sort[0] ?? { field: 'created_at', desc: true };
    const { data, isPending, isFetching, error } = useSubmissionData({
        template_id: templateId,
        filter: state.filter,
        search: state.search || undefined,
        sort: [sort],
        page: state.page,
        page_size: pageSize
    });
    const sortable = schema.fields.filter((f) => f.sortable);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">Sort by</span>
                <Select value={sort.field} onValueChange={(v) => patch({ sort: [{ field: v, desc: sort.desc }] })}>
                    <SelectTrigger size="sm" aria-label="Sort by">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {sortable.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                                {f.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <IconButton
                    label={sort.desc ? 'Descending' : 'Ascending'}
                    onClick={() => patch({ sort: [{ field: sort.field, desc: !sort.desc }] })}
                >
                    {sort.desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                </IconButton>
            </div>

            {isPending ? (
                <InlineStatus loading />
            ) : error ? (
                <InlineStatus error={requestErrorMessage(error)} />
            ) : data && data.items.length === 0 ? (
                <EmptyBox>
                    {state.search || state.filter.items.length
                        ? 'No requests match these filters.'
                        : (emptyMessage ?? 'No requests yet.')}
                </EmptyBox>
            ) : (
                <div
                    className={cn(
                        'grid grid-cols-1 gap-3 transition-opacity md:grid-cols-2 xl:grid-cols-3',
                        isFetching && 'opacity-60'
                    )}
                    data-cards
                >
                    {data?.items.map((row) => (
                        <RecordCard
                            key={row.id}
                            row={row}
                            schema={schema}
                            labeler={labeler}
                            onOpen={onOpen}
                            actions={rowActions?.(row)}
                        />
                    ))}
                </div>
            )}
            <Pager
                page={state.page}
                pageSize={pageSize}
                total={data?.total ?? 0}
                pageSizes={PAGE_SIZES}
                noun="requests"
                onChange={(n) =>
                    patch(n.pageSize !== pageSize ? { pageSize: n.pageSize, page: 1 } : { page: n.page, pageSize })
                }
            />
        </div>
    );
}
