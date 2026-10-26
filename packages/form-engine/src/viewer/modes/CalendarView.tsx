'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
    Button,
    IconButton,
    InlineStatus,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    cn,
    toneOf,
    type Tone
} from '@itrms/ui';
import { requestErrorMessage } from '../../host/client';
import { useEngineText } from '../../host/text';
import type { EngineMessageKey } from '../../core/messages';
import { useSubmissionData } from '../api';
import { titleOf, valueOf } from '../components';
import type { ViewModeProps } from '../registry';
import type { Condition, FilterGroup, ViewRow } from '../types';

const MAX_ROWS = 100;
const SHOWN_PER_DAY = 3;
const WEEKDAYS: EngineMessageKey[] = [
    'form-engine.viewer.calendar.sun',
    'form-engine.viewer.calendar.mon',
    'form-engine.viewer.calendar.tue',
    'form-engine.viewer.calendar.wed',
    'form-engine.viewer.calendar.thu',
    'form-engine.viewer.calendar.fri',
    'form-engine.viewer.calendar.sat'
];
/** The left edge of an event says its status (the text says it too, in the tooltip). */
const EDGE: Record<Tone, string> = {
    neutral: 'border-l-status-neutral',
    info: 'border-l-status-info',
    progress: 'border-l-status-progress',
    success: 'border-l-status-success',
    warning: 'border-l-status-warning',
    danger: 'border-l-status-danger',
    muted: 'border-l-status-muted'
};

const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthKey = (d: Date) => ymd(d).slice(0, 7);
/** The calendar day of a stored date ("2026-09-15" as is; a date-time as the reader's local day). */
function dayOf(v: unknown): string | null {
    if (typeof v !== 'string' || !v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : ymd(d);
}
const addDays = (key: string, n: number) => {
    const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + n);
    return ymd(d);
};

export default function CalendarView({ templateId, schema, state, patch, labeler, onOpen }: ViewModeProps) {
    const { t, language } = useEngineText();
    const dateFields = schema.fields.filter((f) => f.kind === 'date' || f.kind === 'datetime');
    const dateKey = (state.options.dateField as string) || schema.roles.date || dateFields[0]?.key;
    const endKey = dateKey === schema.roles.date ? schema.roles.dateEnd : null;
    // only read while a date field exists (the queries below are off without one)
    const dateColumn = dateKey ?? '';
    const [shownMonth, setShownMonth] = useState<string>((state.options.month as string) || monthKey(new Date()));
    const [expanded, setExpanded] = useState<string | null>(null);
    const setMonth = (m: string) => {
        setShownMonth(m);
        patch({ options: { ...state.options, month: m }, page: 1 });
    };

    const [year = 1970, month = 1] = shownMonth.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const lastKey = ymd(new Date(year, month, 0));
    const firstKey = ymd(first);
    // the grid: whole weeks covering the month
    const gridStart = addDays(firstKey, -first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(year, month, 0).getDate()) / 7);
    const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i)), [gridStart, weeks]);

    const inMonth: Condition | FilterGroup = endKey
        ? {
              op: 'or',
              items: [
                  { field: dateColumn, op: 'between', value: [firstKey, lastKey] },
                  {
                      op: 'and',
                      items: [
                          { field: dateColumn, op: 'lte', value: lastKey },
                          { field: endKey, op: 'gte', value: firstKey }
                      ]
                  }
              ]
          }
        : { field: dateColumn, op: 'between', value: [firstKey, lastKey] };
    const filter: FilterGroup = { op: 'and', items: [...(state.filter.items.length ? [state.filter] : []), inMonth] };
    const { data, isPending, error } = useSubmissionData(
        dateKey
            ? {
                  template_id: templateId,
                  filter,
                  search: state.search || undefined,
                  sort: [{ field: dateKey }],
                  page: 1,
                  page_size: MAX_ROWS
              }
            : null
    );
    const undated = useSubmissionData(
        dateKey
            ? {
                  template_id: templateId,
                  filter: {
                      op: 'and',
                      items: [...(state.filter.items.length ? [state.filter] : []), { field: dateKey, op: 'empty' }]
                  },
                  search: state.search || undefined,
                  rows: false
              }
            : null
    );

    const byDay = useMemo(() => {
        const map = new Map<string, ViewRow[]>();
        for (const row of data?.items ?? []) {
            const start = dayOf(valueOf(row, dateColumn));
            if (!start) continue;
            const end = endKey ? dayOf(valueOf(row, endKey)) : null;
            const last = end && end >= start ? end : start;
            for (let d = start, guard = 0; d <= last && guard < 400; d = addDays(d, 1), guard++) {
                if (d < gridStart || d > (days[days.length - 1] ?? gridStart)) continue;
                map.set(d, [...(map.get(d) ?? []), row]);
            }
        }
        return map;
    }, [data, dateColumn, endKey, gridStart, days]);

    if (!dateKey) return <InlineStatus error={t('form-engine.viewer.calendar.noDateField')} />;
    const today = ymd(new Date());
    // the month in the screen's language (Gregorian: the grid is laid out by Gregorian month)
    const title = first.toLocaleDateString(language === 'en' ? 'en-US' : 'am-ET', { month: 'long', year: 'numeric' });
    const step = (n: number) => setMonth(monthKey(new Date(year, month - 1 + n, 1)));

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <IconButton label={t('form-engine.viewer.calendar.previous')} onClick={() => step(-1)}>
                    <ChevronLeft />
                </IconButton>
                <h2 className="min-w-44 text-center text-xl font-semibold" aria-live="polite" data-month={shownMonth}>
                    {title}
                </h2>
                <IconButton label={t('form-engine.viewer.calendar.next')} onClick={() => step(1)}>
                    <ChevronRight />
                </IconButton>
                <Button type="button" variant="outline" size="sm" onClick={() => setMonth(monthKey(new Date()))}>
                    {t('form-engine.viewer.calendar.today')}
                </Button>
                {dateFields.length > 1 && (
                    <Select
                        value={dateKey}
                        onValueChange={(v) =>
                            patch({ options: { ...state.options, dateField: v, month: shownMonth }, page: 1 })
                        }
                    >
                        <SelectTrigger size="sm" aria-label={t('form-engine.viewer.calendar.dateField')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {dateFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                    {f.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <span className="ml-auto text-sm text-muted-foreground">
                    {t('form-engine.viewer.calendar.thisMonth', { count: data?.total ?? 0 })}
                    {(undated.data?.total ?? 0) > 0 &&
                        ` · ${t('form-engine.viewer.calendar.undated', { count: String(undated.data?.total) })}`}
                </span>
            </div>
            {error ? (
                <InlineStatus error={requestErrorMessage(error, undefined, t)} />
            ) : isPending ? (
                <InlineStatus loading />
            ) : null}
            {data && data.total > MAX_ROWS && (
                <span className="text-sm text-destructive">
                    {t('form-engine.viewer.calendar.firstOf', { max: String(MAX_ROWS), total: String(data.total) })}
                </span>
            )}
            <div className="overflow-x-auto">
                <div
                    role="grid"
                    aria-label={title}
                    className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-lg border"
                    data-calendar
                >
                    {WEEKDAYS.map((w) => (
                        <div key={w} role="columnheader" className="bg-muted/60 p-2 text-center text-sm font-semibold">
                            {t(w)}
                        </div>
                    ))}
                    {days.map((d) => {
                        const events = byDay.get(d) ?? [];
                        const open = expanded === d;
                        const shown = open ? events : events.slice(0, SHOWN_PER_DAY);
                        const out = d.slice(0, 7) !== shownMonth;
                        return (
                            <div
                                key={d}
                                role="gridcell"
                                data-day={d}
                                className={cn(
                                    'flex min-h-26 flex-col gap-1 border-t border-l p-1',
                                    out && 'opacity-45',
                                    d === today && 'bg-primary/5'
                                )}
                            >
                                <span
                                    className={
                                        d === today ? 'text-sm font-bold text-primary' : 'text-sm text-muted-foreground'
                                    }
                                >
                                    {Number(d.slice(8))}
                                </span>
                                {shown.map((row) => (
                                    <button
                                        key={`${row.id}-${d}`}
                                        type="button"
                                        className={cn(
                                            'w-full truncate rounded-sm border border-l-[3px] bg-card px-1.5 py-1 text-left text-xs shadow-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                            EDGE[toneOf(row.status)]
                                        )}
                                        onClick={() => onOpen(row)}
                                        title={`${titleOf(row, schema, labeler)} · ${row.status ?? ''}`}
                                        data-event={row.id}
                                    >
                                        {titleOf(row, schema, labeler)}
                                    </button>
                                ))}
                                {events.length > SHOWN_PER_DAY && (
                                    <button
                                        type="button"
                                        className="text-left text-xs text-primary hover:underline"
                                        onClick={() => setExpanded(open ? null : d)}
                                    >
                                        {open
                                            ? t('form-engine.viewer.calendar.showLess')
                                            : t('form-engine.viewer.calendar.more', {
                                                  count: String(events.length - SHOWN_PER_DAY)
                                              })}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
