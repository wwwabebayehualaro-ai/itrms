'use client';

import { useMemo } from 'react';
import { InlineStatus, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { formatCurrency } from '../../host/format';
import { useSubmissionData } from '../api';
import { EmptyBox } from '../components';
import { andFilter, groupCondition, groupLabel } from '../drill';
import type { ViewModeProps } from '../registry';
import type { AggFn, Bucket, ViewField } from '../types';

const MAX_COLUMNS = 12;
const FN_LABEL: Record<AggFn, string> = {
    count: 'Count',
    sum: 'Sum of',
    avg: 'Average of',
    min: 'Smallest',
    max: 'Largest'
};
const NONE = '__none__';

const isDate = (f?: ViewField) => f?.kind === 'date' || f?.kind === 'datetime';

/** A labelled setting of the pivot (rows, columns, value, dates by). */
function Setting({
    label,
    value,
    options,
    onChange,
    width = 'w-56'
}: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (v: string) => void;
    width?: string;
}) {
    return (
        <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger aria-label={label} className={width}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

export default function PivotView({ templateId, schema, state, patch, labeler }: ViewModeProps) {
    const groupable = schema.fields.filter((f) => f.groupable);
    const o = state.options as { rows?: string; cols?: string; fn?: AggFn; measure?: string; bucket?: Bucket };
    const rowsKey =
        o.rows && groupable.some((f) => f.key === o.rows)
            ? o.rows
            : (groupable.find((f) => f.key === schema.roles.stage) ?? groupable[0])?.key;
    const colsKey = o.cols && o.cols !== rowsKey && groupable.some((f) => f.key === o.cols) ? o.cols : undefined;
    const measures = schema.fields.filter((f) => f.aggregatable);
    const measure = measures.find((f) => f.key === o.measure) ?? measures[0];
    const fn: AggFn = o.fn && (o.fn === 'count' || measure) ? o.fn : 'count';
    const rowField = groupable.find((f) => f.key === rowsKey);
    const colField = groupable.find((f) => f.key === colsKey);
    const bucket = o.bucket ?? 'month';
    const set = (change: Record<string, unknown>) => patch({ options: { ...state.options, ...change }, page: 1 });

    const aggs = [
        { fn: 'count' as const, alias: 'n' },
        ...(fn !== 'count' && measure ? [{ fn, field: measure.key, alias: 'v' }] : [])
    ];
    const common = {
        template_id: templateId,
        filter: state.filter,
        search: state.search || undefined,
        rows: false,
        aggregates: aggs
    };
    const gb = (f?: ViewField) => (f ? { field: f.key, bucket: isDate(f) ? bucket : undefined } : undefined);
    const cells = useSubmissionData(rowField ? { ...common, group_by: gb(rowField), then_by: gb(colField) } : null);
    const rowTotals = useSubmissionData(rowField && colField ? { ...common, group_by: gb(rowField) } : null);
    const colTotals = useSubmissionData(rowField && colField ? { ...common, group_by: gb(colField) } : null);

    const value = (
        g: { count: number; aggregates: Record<string, number | null> } | undefined | null
    ): number | null => (!g ? null : fn === 'count' ? g.count : (g.aggregates.v ?? null));
    const show = (v: number | null) =>
        v === null
            ? ''
            : fn !== 'count' && measure?.currency
              ? formatCurrency(v, measure.currency)
              : v.toLocaleString('en-US', { maximumFractionDigits: fn === 'count' ? 0 : 2 });

    const model = useMemo(() => {
        const result = cells.data;
        if (!result) return null;
        const colOrder = colField ? (colTotals.data?.groups ?? []).map((g) => g.key) : [];
        const rowOrder = (colField ? (rowTotals.data?.groups ?? []) : result.groups).map((g) => g.key);
        const matrix = new Map<string, number | null>();
        for (const g of result.groups) matrix.set(`${g.key}\u0000${g.key2}`, value(g));
        const sortedCols = colField && isDate(colField) ? [...colOrder].sort() : colOrder;
        const cols = sortedCols.slice(0, MAX_COLUMNS);
        const rowTotal = new Map(
            (colField ? (rowTotals.data?.groups ?? []) : result.groups).map((g) => [g.key, value(g)])
        );
        const colTotal = new Map((colTotals.data?.groups ?? []).map((g) => [g.key, value(g)]));
        const grand = fn === 'count' ? result.aggregates.n : result.aggregates.v;
        const all = [...matrix.values()].filter((v): v is number => v !== null);
        return {
            rowOrder,
            cols,
            hidden: sortedCols.length - cols.length,
            matrix,
            rowTotal,
            colTotal,
            grand: grand ?? null,
            max: Math.max(1e-9, ...all.map(Math.abs))
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cells.data, rowTotals.data, colTotals.data, colField, fn]);

    if (!rowField) return <InlineStatus error="This form has no field to group requests by." />;
    const loading = cells.isPending || (!!colField && (rowTotals.isPending || colTotals.isPending));
    const error = cells.error ?? rowTotals.error ?? colTotals.error;
    const fieldOptions = groupable.map((f) => ({ label: f.label, value: f.key }));
    const valueOptions = [
        { label: 'Count of requests', value: 'count' },
        ...measures.flatMap((m) =>
            (['sum', 'avg', 'min', 'max'] as const).map((f) => ({
                label: `${FN_LABEL[f]} ${m.label}`,
                value: `${f}:${m.key}`
            }))
        )
    ];

    const drill = (rowKey: string | null, colKey?: string | null) => {
        const conds = [
            groupCondition(rowField, rowKey, bucket),
            ...(colField && colKey !== undefined ? [groupCondition(colField, colKey, bucket)] : [])
        ];
        patch({ mode: 'table', filter: andFilter(state.filter, ...conds), options: {}, sort: [], page: 1 });
    };
    // heat: the cell's share of the largest value tints it with the primary colour (the number stays in the text colour)
    const cellStyle = (v: number | null) =>
        v === null
            ? undefined
            : {
                  background: `color-mix(in oklab, var(--primary) ${Math.round((Math.abs(v) / (model?.max ?? 1)) * 30)}%, transparent)`
              };
    const th = 'p-2 text-sm font-semibold';
    const num = 'p-2 text-right text-sm tabular-nums';
    const drillButton =
        'block w-full p-2 text-right tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset';

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
                <Setting label="Rows" value={rowsKey!} options={fieldOptions} onChange={(v) => set({ rows: v })} />
                <Setting
                    label="Columns"
                    value={colsKey ?? NONE}
                    options={[{ label: 'None', value: NONE }, ...fieldOptions.filter((f) => f.value !== rowsKey)]}
                    onChange={(v) => set({ cols: v === NONE ? undefined : v })}
                />
                <Setting
                    label="Value"
                    value={fn === 'count' || !measure ? 'count' : `${fn}:${measure.key}`}
                    options={valueOptions}
                    onChange={(v) =>
                        v === 'count' ? set({ fn: 'count' }) : set({ fn: v.split(':')[0], measure: v.split(':')[1] })
                    }
                    width="w-64"
                />
                {(isDate(rowField) || isDate(colField)) && (
                    <Setting
                        label="Dates by"
                        value={bucket}
                        options={[
                            { label: 'Month', value: 'month' },
                            { label: 'Year', value: 'year' },
                            { label: 'Day', value: 'day' }
                        ]}
                        onChange={(v) => set({ bucket: v })}
                        width="w-32"
                    />
                )}
            </div>

            {error ? (
                <InlineStatus error={requestErrorMessage(error)} />
            ) : loading || !model ? (
                <InlineStatus loading />
            ) : model.rowOrder.length === 0 ? (
                <EmptyBox>No requests match.</EmptyBox>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full border-collapse" data-pivot>
                        <caption className="sr-only">
                            {FN_LABEL[fn]} {measure?.label ?? 'requests'} by {rowField.label}
                            {colField ? ` and ${colField.label}` : ''}
                        </caption>
                        <thead className="bg-muted/60">
                            <tr>
                                <th scope="col" className={`${th} text-left`}>
                                    {rowField.label}
                                </th>
                                {colField ? (
                                    model.cols.map((c) => (
                                        <th key={String(c)} scope="col" className={`${th} text-right`}>
                                            {groupLabel(colField, c, bucket, labeler.text)}
                                        </th>
                                    ))
                                ) : (
                                    <th scope="col" className={`${th} text-right`}>
                                        {fn === 'count' ? 'Requests' : `${FN_LABEL[fn]} ${measure?.label}`}
                                    </th>
                                )}
                                {colField && (
                                    <th scope="col" className={`${th} text-right`}>
                                        Total
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {model.rowOrder.map((r) => (
                                <tr key={String(r)} className="border-t">
                                    <th scope="row" className={`${th} text-left`}>
                                        {groupLabel(rowField, r, bucket, labeler.text)}
                                    </th>
                                    {colField ? (
                                        model.cols.map((c) => {
                                            const v = model.matrix.get(`${r}\u0000${c}`) ?? null;
                                            return (
                                                <td
                                                    key={String(c)}
                                                    className="p-0 text-right text-sm"
                                                    style={cellStyle(v)}
                                                    data-cell={`${r ?? ''}|${c ?? ''}`}
                                                >
                                                    {v === null ? (
                                                        <span className="block p-2 text-muted-foreground">·</span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className={drillButton}
                                                            onClick={() => drill(r, c)}
                                                            aria-label={`${show(v)}: show these requests`}
                                                        >
                                                            {show(v)}
                                                        </button>
                                                    )}
                                                </td>
                                            );
                                        })
                                    ) : (
                                        <td
                                            className="p-0 text-right text-sm"
                                            style={cellStyle(model.rowTotal.get(r) ?? null)}
                                            data-cell={`${r ?? ''}`}
                                        >
                                            <button
                                                type="button"
                                                className={drillButton}
                                                onClick={() => drill(r)}
                                                aria-label={`${show(model.rowTotal.get(r) ?? null)}: show these requests`}
                                            >
                                                {show(model.rowTotal.get(r) ?? null)}
                                            </button>
                                        </td>
                                    )}
                                    {colField && (
                                        <td className={`${num} font-semibold`} data-row-total={r ?? ''}>
                                            {show(model.rowTotal.get(r) ?? null)}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 bg-muted/30">
                                <th scope="row" className={`${th} text-left`}>
                                    Total
                                </th>
                                {colField &&
                                    model.cols.map((c) => (
                                        <td key={String(c)} className={`${num} font-semibold`}>
                                            {show(model.colTotal.get(c) ?? null)}
                                        </td>
                                    ))}
                                <td className={`${num} font-semibold`} data-grand>
                                    {show(model.grand)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    {model.hidden > 0 && (
                        <p className="border-t p-2 text-sm text-muted-foreground">
                            Showing {MAX_COLUMNS} of {MAX_COLUMNS + model.hidden} columns. Filter to narrow it down.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
