'use client';

import { useMemo, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { MoveHorizontal } from 'lucide-react';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
    InlineStatus,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn
} from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { useEngineText } from '../../host/text';
import { formatCurrency } from '../../host/format';
import { useSubmissionData } from '../api';
import { RecordCard } from '../components';
import type { Labeler } from '../labels';
import type { ViewModeProps } from '../registry';
import { useCanChangeRequests, useSubmissionMutations } from '../../api/submissions';
import type { Condition, FilterGroup, ViewField, ViewRow } from '../types';

const PAGE = 10;
const MAX_CARDS = 100;
const NONE = '__none__';

interface Column {
    value: string; // NONE for requests without a value
    label: string;
}

/** The columns of a board: every value the stage field can take, plus any value that exists in the data, plus "No value". */
function useColumns(templateId: string, stage: ViewField, labeler: Labeler, filter: FilterGroup, search: string) {
    const { t } = useEngineText();
    const facet = useSubmissionData({
        template_id: templateId,
        filter,
        search: search || undefined,
        rows: false,
        facets: [stage.key]
    });
    const columns = useMemo<Column[]>(() => {
        const known: Column[] = labeler.options(stage.key).map((o) => ({ value: String(o.value), label: o.label }));
        const seen = facet.data?.facets[stage.key] ?? [];
        const extra = seen
            .filter((f) => f.value !== null && !known.some((k) => k.value === f.value))
            .map((f) => ({ value: f.value as string, label: labeler.text(stage.key, f.value) }));
        const hasNone = seen.some((f) => f.value === null);
        return [
            ...known,
            ...extra,
            ...(hasNone || !known.length ? [{ value: NONE, label: t('form-engine.viewer.board.noValue') }] : [])
        ];
    }, [stage, labeler, facet.data, t]);
    return { columns, isPending: facet.isPending, error: facet.error };
}

function DraggableCard({ row, disabled, children }: { row: ViewRow; disabled: boolean; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: row.id,
        data: { row },
        disabled
    });
    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={cn('touch-none', isDragging && 'opacity-35', disabled ? 'cursor-default' : 'cursor-grab')}
            tabIndex={-1}
            role="group"
        >
            {children}
        </div>
    );
}

/** "Move to…": the keyboard and touch friendly way to change a card's column. */
function MoveMenu({
    row,
    column,
    columns,
    onMove
}: {
    row: ViewRow;
    column: Column;
    columns: Column[];
    onMove: (row: ViewRow, to: Column) => void;
}) {
    const { t } = useEngineText();
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('form-engine.viewer.board.move', { id: row.id })}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                        >
                            <MoveHorizontal />
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('form-engine.viewer.board.moveTo')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('form-engine.viewer.board.moveToLabel')}</DropdownMenuLabel>
                {columns
                    .filter((c) => c.value !== column.value)
                    .map((c) => (
                        <DropdownMenuItem key={c.value} onSelect={() => onMove(row, c)}>
                            {c.label}
                        </DropdownMenuItem>
                    ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function BoardColumn({
    column,
    columns,
    props,
    stage,
    canMove,
    onMove
}: {
    column: Column;
    columns: Column[];
    props: ViewModeProps;
    stage: ViewField;
    canMove: boolean;
    onMove: (row: ViewRow, to: Column) => void;
}) {
    const { templateId, schema, state, labeler, onOpen, rowActions } = props;
    const { t } = useEngineText();
    const [limit, setLimit] = useState(PAGE);
    const measure = schema.roles.measures[0];
    const here: Condition =
        column.value === NONE ? { field: stage.key, op: 'empty' } : { field: stage.key, op: 'eq', value: column.value };
    const filter: FilterGroup = { op: 'and', items: [...(state.filter.items.length ? [state.filter] : []), here] };
    const { data, isPending, error } = useSubmissionData({
        template_id: templateId,
        filter,
        search: state.search || undefined,
        sort: [{ field: 'created_at', desc: true }],
        page: 1,
        page_size: limit,
        aggregates: measure ? [{ fn: 'sum', field: measure, alias: 'sum' }] : []
    });
    const { setNodeRef, isOver } = useDroppable({ id: `col:${column.value}`, data: { column } });
    const mf = measure ? schema.fields.find((f) => f.key === measure) : undefined;
    const sum = data?.aggregates.sum;

    return (
        <section
            ref={setNodeRef}
            className={cn(
                'flex min-h-32 w-72 shrink-0 flex-col gap-2 rounded-lg p-2 transition-colors',
                isOver ? 'bg-primary/10 ring-2 ring-primary/40' : 'bg-muted/60'
            )}
            aria-label={t('form-engine.viewer.board.column', { label: column.label })}
            data-column={column.value}
        >
            <header className="flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold capitalize">{column.label}</h3>
                <span className="text-sm text-muted-foreground tabular-nums" data-count>
                    {data?.total ?? 0}
                    {sum != null && mf
                        ? ` · ${mf.currency ? formatCurrency(sum, mf.currency) : sum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                        : ''}
                </span>
            </header>
            {isPending ? (
                <InlineStatus loading />
            ) : error ? (
                <InlineStatus error={requestErrorMessage(error, undefined, t)} />
            ) : null}
            {data?.items.map((row) => (
                <DraggableCard key={row.id} row={row} disabled={!canMove}>
                    <RecordCard
                        row={row}
                        schema={schema}
                        labeler={labeler}
                        onOpen={onOpen}
                        facts={2}
                        actions={
                            <>
                                {canMove && <MoveMenu row={row} column={column} columns={columns} onMove={onMove} />}
                                {rowActions?.(row)}
                            </>
                        }
                    />
                </DraggableCard>
            ))}
            {data && data.items.length < data.total && limit < MAX_CARDS && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
                    {t('form-engine.viewer.board.showMore', { count: String(data.total - data.items.length) })}
                </Button>
            )}
            {data && data.total > MAX_CARDS && limit >= MAX_CARDS && (
                <span className="px-1 text-xs text-muted-foreground">
                    {t('form-engine.viewer.board.newest', { count: String(MAX_CARDS) })}
                </span>
            )}
        </section>
    );
}

export default function BoardView(props: ViewModeProps) {
    const stage = props.schema.fields.find((f) => f.key === props.schema.roles.stage);
    return stage ? <Board {...props} stage={stage} /> : null;
}

function Board(props: ViewModeProps & { stage: ViewField }) {
    const { templateId, schema, stage, state, labeler } = props;
    const { t } = useEngineText();
    const { columns, isPending, error } = useColumns(templateId, stage, labeler, state.filter, state.search);
    const canMove = useCanChangeRequests() && !stage.builtin;
    const { update } = useSubmissionMutations();
    const [dragging, setDragging] = useState<ViewRow | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor)
    );

    const move = (row: ViewRow, to: Column) => {
        const value = to.value === NONE ? null : to.value;
        return update.mutate({
            id: row.id,
            data: { submission_data: { ...row.submission_data, [stage.key]: value } }
        });
    };
    const onDragEnd = (e: DragEndEvent) => {
        setDragging(null);
        const row = e.active.data.current?.row as ViewRow | undefined;
        const to = e.over?.data.current?.column as Column | undefined;
        if (!row || !to) return;
        const current = row.submission_data?.[stage.key];
        if ((current ?? NONE) !== to.value) move(row, to);
    };

    if (isPending) return <InlineStatus loading />;
    if (error) return <InlineStatus error={requestErrorMessage(error, undefined, t)} />;

    return (
        <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
                {t(canMove ? 'form-engine.viewer.board.columnsMovable' : 'form-engine.viewer.board.columns', {
                    label: stage.label
                })}
            </span>
            <DndContext
                sensors={sensors}
                onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.row as ViewRow) ?? null)}
                onDragEnd={onDragEnd}
                onDragCancel={() => setDragging(null)}
            >
                <div className="flex items-start gap-3 overflow-x-auto pb-2" data-board>
                    {columns.map((c) => (
                        <BoardColumn
                            key={c.value}
                            column={c}
                            columns={columns}
                            props={props}
                            stage={stage}
                            canMove={canMove}
                            onMove={move}
                        />
                    ))}
                </div>
                <DragOverlay>
                    {dragging ? (
                        <div className="w-68 rotate-1 shadow-lg">
                            <RecordCard
                                row={dragging}
                                schema={schema}
                                labeler={labeler}
                                onOpen={() => undefined}
                                facts={2}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    );
}
