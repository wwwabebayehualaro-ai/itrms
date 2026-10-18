'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Download, RefreshCw, Search, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, IconButton, InlineStatus, Input, Spinner, ToggleGroup, ToggleGroupItem, cn, useNotify } from '@platform/ui';
import { useCan } from '@platform/lib/auth/authHooks';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { viewKeys, useViewSchema } from './api';
import { useExportRequests } from './exportApi';
import { FilterBuilder, describeCondition } from './FilterBuilder';
import { useLabeler } from './labels';
import './modes';
import { ViewMode, ViewModeProps, getViewModes } from './registry';
import { useViewState } from './state';
import { ViewsMenu } from './ViewsMenu';
import { stateOf, useSavedViews } from './viewsApi';
import { Condition, EMPTY_FILTER, ViewRow } from './types';

export interface DataViewerProps {
    templateId: string;
    onOpen: (row: ViewRow) => void;
    rowActions?: ViewModeProps['rowActions'];
    /** Buttons next to the view switcher (e.g. "New request"). */
    toolbarExtra?: ReactNode;
    /** Extra view modes for this screen only (e.g. a hand-built report). */
    customViews?: ViewMode[];
    emptyMessage?: string;
}

export function ModeIcon({ icon: Icon, className }: { icon: ViewMode['icon']; className?: string }) {
    return <Icon className={className} />;
}

/** A removable chip of the active filters. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <Badge variant="secondary" className="h-7 gap-1 pr-1 text-sm font-normal">
            {label}
            <button type="button" className="rounded-full p-0.5 hover:bg-background/60" aria-label={`Remove ${label}`} onClick={onRemove}>
                <X className="size-3.5" />
            </button>
        </Badge>
    );
}

/**
 * The data viewer for the submissions of ANY form. It asks the server what the form's data looks like (fields, operators, roles)
 * and offers the view modes that make sense for it: table, cards, board, calendar, pivot, dashboard. The view (mode, search, filter,
 * sort, page) lives in the URL, so every view can be bookmarked and shared.
 */
export function DataViewer({ templateId, onOpen, rowActions, toolbarExtra, customViews, emptyMessage }: DataViewerProps) {
    const { data: schema, isPending, error } = useViewSchema(templateId);
    const labeler = useLabeler(schema);
    const qc = useQueryClient();
    const notify = useNotify();
    const canExport = useCan('submission:export');
    const exporter = useExportRequests();
    const modes = useMemo(() => (schema ? getViewModes(schema, customViews) : []), [schema, customViews]);
    const defaultMode = modes.find((m) => m.default)?.id ?? modes[0]?.id ?? 'table';
    const [state, patch, pristine] = useViewState(defaultMode);

    // a link with just ?v=<id>, or no settings at all and a default view: open that view
    const { data: views } = useSavedViews(templateId);
    const applied = useRef(false);
    useEffect(() => {
        if (applied.current || !views || !pristine) return;
        applied.current = true;
        const wanted = state.viewId ? views.find((v) => v.id === state.viewId) : views.find((v) => v.is_default);
        if (wanted) patch({ ...stateOf(wanted.config), viewId: wanted.id });
    }, [views, pristine, state.viewId, patch]);

    // "Live": refresh every 20 s while the tab is visible (new and changed requests appear without a reload)
    const [live, setLive] = useState(false);
    useEffect(() => {
        if (!live) return;
        const t = setInterval(() => document.visibilityState === 'visible' && qc.invalidateQueries({ queryKey: viewKeys.all }), 20_000);
        return () => clearInterval(t);
    }, [live, qc]);

    // debounced search box
    const [q, setQ] = useState(state.search);
    const [shownSearch, setShownSearch] = useState(state.search);
    if (shownSearch !== state.search) {
        // the search changed from outside (a chip removed, a saved view opened): show it in the box
        setShownSearch(state.search);
        setQ(state.search);
    }
    useEffect(() => {
        if (q === state.search) return;
        const t = setTimeout(() => patch({ search: q }), 300);
        return () => clearTimeout(t);
    }, [q, state.search, patch]);

    if (isPending) return <InlineStatus loading />;
    if (error || !schema) return <InlineStatus error={getApiErrorMessage(error, 'Could not load this form’s data')} />;

    const mode = modes.find((m) => m.id === state.mode) ?? modes[0];
    const conditions = state.filter.items.filter((i): i is Condition => !('items' in i));
    const Body = mode.component;

    return (
        <div className="flex flex-col gap-3" data-viewer>
            <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="single" variant="outline" value={mode.id} onValueChange={(v) => v && patch({ mode: v, page: 1, options: {} })} aria-label="View" data-modes>
                    {modes.map((m) => (
                        <ToggleGroupItem key={m.id} value={m.id} aria-label={m.label} title={m.label} className="gap-2 px-3">
                            <ModeIcon icon={m.icon} className="size-4" />
                            <span className="hidden md:inline">{m.label}</span>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <div className="relative min-w-40 max-w-sm flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requests" className="pl-8" aria-label="Search requests" />
                </div>
                <FilterBuilder schema={schema} labeler={labeler} value={state.filter} onApply={(filter) => patch({ filter })} />
                <ViewsMenu templateId={templateId} state={state} defaultMode={defaultMode} patch={patch} />
                {canExport && (
                    <Button
                        type="button"
                        variant="outline"
                        disabled={exporter.isPending}
                        onClick={async () => notify.success(`Exported ${await exporter.mutateAsync({ template_id: templateId, filter: state.filter, search: state.search || undefined, sort: state.sort })} requests`)}
                        title="Download these requests as CSV"
                    >
                        {exporter.isPending ? <Spinner /> : <Download />}
                        Export
                    </Button>
                )}
                <IconButton label="Refresh" onClick={() => qc.invalidateQueries({ queryKey: viewKeys.all })}>
                    <RefreshCw />
                </IconButton>
                <IconButton label="Refresh automatically" tooltip={live ? 'Live: refreshing every 20 s' : 'Refresh automatically'} aria-pressed={live} variant={live ? 'secondary' : 'ghost'} onClick={() => setLive(!live)}>
                    <Activity className={cn(live && 'text-primary animate-pulse')} />
                </IconButton>
                <span className="ml-auto flex gap-2">{toolbarExtra}</span>
            </div>

            {(conditions.length > 0 || state.search) && (
                <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
                    {state.search && <FilterChip label={`Search: “${state.search}”`} onRemove={() => patch({ search: '' })} />}
                    {conditions.map((c, i) => (
                        <FilterChip key={i} label={describeCondition(c, schema, labeler)} onRemove={() => patch({ filter: { ...state.filter, items: conditions.filter((_, j) => j !== i) } })} />
                    ))}
                    <Button type="button" variant="link" size="sm" onClick={() => patch({ search: '', filter: EMPTY_FILTER })}>
                        Clear all
                    </Button>
                </div>
            )}

            <Body key={mode.id} templateId={templateId} schema={schema} state={state} patch={patch} labeler={labeler} onOpen={onOpen} rowActions={rowActions} emptyMessage={emptyMessage} />
        </div>
    );
}
