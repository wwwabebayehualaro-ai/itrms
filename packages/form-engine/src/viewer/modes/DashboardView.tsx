'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis, type BarShapeProps } from 'recharts';
import { ChartColumn, Table2 } from 'lucide-react';
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    IconButton,
    InlineStatus,
    type ChartConfig
} from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { useEngineText } from '../../host/text';
import { formatCurrency } from '../../host/format';
import { useSubmissionData } from '../api';
import { EmptyBox } from '../components';
import { andFilter, groupCondition, groupLabel } from '../drill';
import type { ViewModeProps } from '../registry';
import type { Bucket, QueryResult, ViewField } from '../types';

const compact = (n: number) =>
    Math.abs(n) >= 10_000
        ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
        : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

// one series in the validated categorical colour; text (labels, ticks, values) stays in the text tokens
const chartConfig = (label: string) => ({ value: { label, color: 'var(--chart-1)' } }) satisfies ChartConfig;

interface Datum {
    key: string | null;
    label: string;
    value: number;
}

/** A chart with a title and a switch to read the same numbers as a table (where each row also drills down, by keyboard too). */
function ChartCard({
    title,
    subtitle,
    children,
    data,
    onPick,
    wide
}: {
    title: string;
    subtitle?: string;
    children: ReactNode;
    data: Datum[];
    onPick: (d: Datum) => void;
    wide?: boolean;
}) {
    const { t } = useEngineText();
    const [asTable, setAsTable] = useState(false);
    return (
        <section
            className={`flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-xs ${wide ? 'lg:col-span-2' : ''}`}
            aria-label={title}
        >
            <header className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
                </div>
                <IconButton
                    label={t(
                        asTable ? 'form-engine.viewer.dashboard.showChart' : 'form-engine.viewer.dashboard.showTable'
                    )}
                    tooltip={t(asTable ? 'form-engine.viewer.dashboard.chart' : 'form-engine.viewer.dashboard.table')}
                    side="left"
                    onClick={() => setAsTable(!asTable)}
                >
                    {asTable ? <ChartColumn /> : <Table2 />}
                </IconButton>
            </header>
            {asTable ? (
                <table className="w-full text-sm">
                    <tbody>
                        {data.map((d) => (
                            <tr key={String(d.key)} className="border-t">
                                <th scope="row" className="py-1 text-left font-normal">
                                    <button
                                        type="button"
                                        className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
                                        onClick={() => onPick(d)}
                                        aria-label={t('form-engine.viewer.dashboard.pick', {
                                            label: d.label,
                                            value: compact(d.value)
                                        })}
                                    >
                                        {d.label}
                                    </button>
                                </th>
                                <td className="py-1 text-right tabular-nums">{compact(d.value)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                children
            )}
        </section>
    );
}

/** A bar with the test/automation hooks of the group it stands for (`data-bar`, `data-value`). */
function HookedBar(props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    payload?: Datum;
    hook: string;
}) {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload, hook } = props;
    const r = hook === 'col' ? Math.min(4, width / 2) : Math.min(4, height / 2);
    // rounded on the value end only
    const path =
        hook === 'col'
            ? `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
            : `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x} Z`;
    return (
        <path
            d={path}
            fill={fill}
            className="cursor-pointer transition-[filter] hover:brightness-110"
            {...{ [`data-${hook}`]: payload?.key ?? '', 'data-value': payload?.value }}
        />
    );
}

function Bars({ data, onPick }: { data: Datum[]; onPick: (d: Datum) => void }) {
    const { t } = useEngineText();
    return (
        <ChartContainer
            config={chartConfig(t('form-engine.viewer.dashboard.requests'))}
            className="aspect-auto w-full"
            style={{ height: data.length * 36 + 8 }}
            initialDimension={{ width: 480, height: data.length * 36 + 8 }}
        >
            <BarChart
                data={data}
                layout="vertical"
                margin={{ left: 0, right: 48, top: 4, bottom: 4 }}
                barCategoryGap={8}
            >
                <YAxis
                    type="category"
                    dataKey="label"
                    width={120}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12 }}
                    interval={0}
                />
                <XAxis type="number" dataKey="value" hide domain={[0, 'dataMax']} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
                <Bar
                    dataKey="value"
                    fill="var(--color-value)"
                    minPointSize={2}
                    isAnimationActive={false}
                    shape={(p: BarShapeProps) => <HookedBar {...p} hook="bar" />}
                    onClick={(e: { payload?: Datum }) => e.payload && onPick(e.payload)}
                >
                    <LabelList
                        dataKey="value"
                        position="right"
                        className="fill-foreground font-semibold"
                        formatter={(v: unknown) => compact(Number(v))}
                        fontSize={12}
                    />
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}

function Columns({ data, onPick }: { data: Datum[]; onPick: (d: Datum) => void }) {
    const { t } = useEngineText();
    return (
        <ChartContainer
            config={chartConfig(t('form-engine.viewer.dashboard.requests'))}
            className="aspect-auto h-56 w-full"
            initialDimension={{ width: 800, height: 224 }}
        >
            <BarChart data={data} margin={{ left: 0, right: 8, top: 20, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 12 }} />
                <YAxis
                    width={40}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    tickFormatter={(v) => compact(Number(v))}
                    tick={{ fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
                <Bar
                    dataKey="value"
                    fill="var(--color-value)"
                    maxBarSize={28}
                    minPointSize={2}
                    isAnimationActive={false}
                    shape={(p: BarShapeProps) => <HookedBar {...p} hook="col" />}
                    onClick={(e: { payload?: Datum }) => e.payload && onPick(e.payload)}
                >
                    <LabelList
                        dataKey="value"
                        position="top"
                        className="fill-foreground"
                        formatter={(v: unknown) => compact(Number(v))}
                        fontSize={11}
                    />
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}

function Tile({ label, value, hint, hero }: { label: string; value: string; hint?: string; hero?: boolean }) {
    return (
        <div
            className="flex flex-col gap-1 rounded-lg border bg-card p-4 text-card-foreground shadow-xs"
            data-tile={label}
        >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span
                className={
                    hero ? 'text-5xl leading-tight font-semibold tabular-nums' : 'text-2xl font-semibold tabular-nums'
                }
            >
                {value}
            </span>
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
    );
}

const MAX_BARS = 8;
const MAX_MONTHS = 12;

export default function DashboardView(props: ViewModeProps) {
    const { schema } = props;
    const stage = schema.fields.find((f) => f.key === schema.roles.stage);
    const dateField =
        schema.fields.find((f) => f.key === schema.roles.date) ?? schema.fields.find((f) => f.key === 'created_at');
    return stage && dateField ? <Dashboard {...props} stage={stage} dateField={dateField} /> : null;
}

function Dashboard({
    templateId,
    schema,
    state,
    patch,
    labeler,
    stage,
    dateField
}: ViewModeProps & { stage: ViewField; dateField: ViewField }) {
    const { t } = useEngineText();
    const measures = schema.fields.filter((f) => f.aggregatable).slice(0, 2);
    const breakdown: ViewField | undefined =
        schema.fields.find((f) => !f.builtin && f.person && f.key !== stage.key) ??
        schema.fields.find(
            (f) =>
                !f.builtin &&
                f.groupable &&
                (f.kind === 'choice' || f.kind === 'text') &&
                f.key !== stage.key &&
                f.key !== schema.roles.title &&
                f.key !== schema.roles.subtitle &&
                (f.kind === 'choice' || f.options.length)
        ) ??
        schema.fields.find((f) => f.key === 'submitted_by');
    const bucket: Bucket = 'month';
    const common = { template_id: templateId, filter: state.filter, search: state.search || undefined, rows: false };
    const summary = useSubmissionData({
        ...common,
        aggregates: [
            { fn: 'count', alias: 'n' },
            ...measures.flatMap((m) => [
                { fn: 'sum' as const, field: m.key, alias: `sum_${m.key}` },
                { fn: 'avg' as const, field: m.key, alias: `avg_${m.key}` }
            ])
        ]
    });
    const byStage = useSubmissionData({ ...common, group_by: { field: stage.key } });
    const byTime = useSubmissionData({ ...common, group_by: { field: dateField.key, bucket } });
    const byBreakdown = useSubmissionData(breakdown ? { ...common, group_by: { field: breakdown.key } } : null);

    const error = summary.error ?? byStage.error ?? byTime.error ?? byBreakdown.error;
    if (error) return <InlineStatus error={requestErrorMessage(error, undefined, t)} />;
    if (summary.isPending) return <InlineStatus loading />;

    const n = summary.data?.aggregates.n ?? 0;
    const data = (r: QueryResult | undefined, f: ViewField, b?: Bucket): Datum[] =>
        (r?.groups ?? []).map((g) => ({ key: g.key, label: groupLabel(f, g.key, b, labeler.text, t), value: g.count }));
    const stageData = data(byStage.data, stage);
    const timeData = data(byTime.data, dateField, bucket)
        .filter((d) => d.key !== null)
        .slice(-MAX_MONTHS);
    const breakdownData = breakdown ? data(byBreakdown.data, breakdown).slice(0, MAX_BARS) : [];
    const drill = (f: ViewField, d: Datum, b?: Bucket) =>
        patch({
            mode: 'table',
            filter: andFilter(state.filter, groupCondition(f, d.key, b)),
            options: {},
            sort: [],
            page: 1
        });
    const money = (m: ViewField, v: number | null | undefined) =>
        v == null ? '—' : m.currency ? formatCurrency(v, m.currency) : compact(v);

    if (n === 0)
        return (
            <EmptyBox>
                {state.search || state.filter.items.length
                    ? t('form-engine.viewer.noMatch')
                    : t('form-engine.viewer.noRequests')}
            </EmptyBox>
        );

    return (
        <div className="flex flex-col gap-3" data-dashboard>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Tile hero label={t('form-engine.viewer.dashboard.requests')} value={n.toLocaleString('en-US')} />
                {measures.map((m) => (
                    <Tile
                        key={m.key}
                        label={t('form-engine.viewer.dashboard.sumOf', { measure: m.label })}
                        value={money(m, summary.data?.aggregates[`sum_${m.key}`])}
                        hint={t('form-engine.viewer.dashboard.average', {
                            value: money(m, summary.data?.aggregates[`avg_${m.key}`])
                        })}
                    />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <ChartCard
                    title={t('form-engine.viewer.dashboard.byField', { field: stage.label.toLowerCase() })}
                    data={stageData}
                    onPick={(d) => drill(stage, d)}
                >
                    <Bars data={stageData} onPick={(d) => drill(stage, d)} />
                </ChartCard>
                {breakdown && breakdownData.length > 0 && (
                    <ChartCard
                        title={t('form-engine.viewer.dashboard.byField', { field: breakdown.label.toLowerCase() })}
                        subtitle={
                            (byBreakdown.data?.groups.length ?? 0) > MAX_BARS
                                ? t('form-engine.viewer.dashboard.top', { count: String(MAX_BARS) })
                                : undefined
                        }
                        data={breakdownData}
                        onPick={(d) => drill(breakdown, d)}
                    >
                        <Bars data={breakdownData} onPick={(d) => drill(breakdown, d)} />
                    </ChartCard>
                )}
                {timeData.length > 0 && (
                    <ChartCard
                        wide
                        title={t('form-engine.viewer.dashboard.byMonth', { field: dateField.label.toLowerCase() })}
                        data={timeData}
                        onPick={(d) => drill(dateField, d, bucket)}
                    >
                        <Columns data={timeData} onPick={(d) => drill(dateField, d, bucket)} />
                    </ChartCard>
                )}
            </div>
        </div>
    );
}
