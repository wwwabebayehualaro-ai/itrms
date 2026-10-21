'use client';

import { RotateCcw } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs';

// The page layouts of design-system.md §7. Each one places the parts a page passes in; none fetches data or knows a
// module. The case layout comes with the workflow engine (task 0.20).

type Slot = React.ReactNode;

export interface ListLayoutProps extends React.ComponentProps<'div'> {
    /** A `PageHeader`. */
    header: Slot;
    /** A `FilterBar`. */
    filters?: Slot;
    /** The `DataGrid`, or an `EmptyState` when there is nothing to list. */
    children: Slot;
}

/** Applications, registries, receipts: header, filters, then the grid. */
export function ListLayout({ header, filters, children, className, ...props }: ListLayoutProps) {
    return (
        <div data-slot="list-layout" className={cn('flex flex-col', className)} {...props}>
            {header}
            {filters}
            {children}
        </div>
    );
}

export interface RecordTab {
    value: string;
    label: Slot;
    content: Slot;
}

export interface RecordLayoutProps extends React.ComponentProps<'div'> {
    /** A `PageHeader` with the record's status and key facts. */
    header: Slot;
    /** The facts every tab needs (usually a `DescriptionList`). */
    summary?: Slot;
    /** Overview, history, documents, related; modules add their own. */
    tabs: RecordTab[];
    defaultTab?: string;
    /** The audit timeline, beside the tabs on a wide screen and under them on a narrow one. */
    aside?: Slot;
}

/** A person, vehicle, licence or organisation. */
export function RecordLayout({ header, summary, tabs, defaultTab, aside, className, ...props }: RecordLayoutProps) {
    return (
        <div data-slot="record-layout" className={cn('@container flex flex-col', className)} {...props}>
            {header}
            <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="flex min-w-0 flex-col gap-4">
                    {summary && <div className="rounded-lg border bg-card p-4">{summary}</div>}
                    <Tabs defaultValue={defaultTab ?? tabs[0]?.value}>
                        <TabsList className="flex-wrap">
                            {tabs.map((t) => (
                                <TabsTrigger key={t.value} value={t.value}>
                                    {t.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {tabs.map((t) => (
                            <TabsContent key={t.value} value={t.value} className="pt-2">
                                {t.content}
                            </TabsContent>
                        ))}
                    </Tabs>
                </div>
                {aside && <aside className="min-w-0">{aside}</aside>}
            </div>
        </div>
    );
}

export interface FormLayoutProps extends React.ComponentProps<'div'> {
    header: Slot;
    /** The form's fields (engine-rendered or hand-written). */
    children: Slot;
    /** Save draft, submit: the bar stays at the bottom of the window while the form scrolls. */
    actions: Slot;
    /** The autosave state ("Draft saved 10:42"), at the start of the action bar. */
    status?: Slot;
    /** A fee preview or help, beside the form on a wide screen. */
    aside?: Slot;
}

/**
 * Intake and step forms. Put the `<form>` element around the layout, so the action bar's submit button belongs to it.
 */
export function FormLayout({ header, children, actions, status, aside, className, ...props }: FormLayoutProps) {
    return (
        <div data-slot="form-layout" className={cn('@container flex flex-col', className)} {...props}>
            {header}
            <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="flex min-w-0 max-w-3xl flex-col gap-4">{children}</div>
                {aside && <aside className="min-w-0">{aside}</aside>}
            </div>
            <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3">
                <div className="text-sm text-muted-foreground" aria-live="polite">
                    {status}
                </div>
                <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </div>
        </div>
    );
}

export interface DashboardLayoutProps extends React.ComponentProps<'div'> {
    header: Slot;
    /** A row of `KpiTile`s. */
    kpis?: Slot;
    /** `WidgetCard`s; the grid fits as many columns as the width allows. */
    children: Slot;
}

/** Role homes and unit KPIs. */
export function DashboardLayout({ header, kpis, children, className, ...props }: DashboardLayoutProps) {
    return (
        <div data-slot="dashboard-layout" className={cn('flex flex-col gap-4', className)} {...props}>
            {header}
            {kpis && <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">{kpis}</div>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">{children}</div>
        </div>
    );
}

export interface SettingsLayoutProps extends React.ComponentProps<'div'> {
    header: Slot;
    /** Links to the sections, beside them on a wide screen. */
    nav?: Slot;
    /** `SettingsSection`s. */
    children: Slot;
}

/** Administration pages. */
export function SettingsLayout({ header, nav, children, className, ...props }: SettingsLayoutProps) {
    return (
        <div data-slot="settings-layout" className={cn('@container flex flex-col', className)} {...props}>
            {header}
            <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[14rem_minmax(0,1fr)]">
                {nav && <nav className="min-w-0">{nav}</nav>}
                <div className="flex min-w-0 flex-col gap-6">{children}</div>
            </div>
        </div>
    );
}

export interface SettingsSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
    title: Slot;
    description?: Slot;
}

export function SettingsSection({ title, description, children, className, ...props }: SettingsSectionProps) {
    const titleId = React.useId();
    return (
        <section
            aria-labelledby={titleId}
            className={cn('flex flex-col rounded-lg border bg-card text-card-foreground', className)}
            {...props}
        >
            <div className="flex flex-col gap-1 border-b p-4">
                <h2 id={titleId} className="text-lg font-semibold">
                    {title}
                </h2>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <div className="flex flex-col divide-y">{children}</div>
        </section>
    );
}

export interface SettingRowProps extends Omit<React.ComponentProps<'div'>, 'children'> {
    label: Slot;
    description?: Slot;
    /** The input for the value. Give it the row's `controlId`, so the label names it. */
    control: Slot;
    controlId: string;
    /** Where the value comes from, in words ("From the region", "Set here"). */
    source: string;
    /** True when this unit set its own value instead of inheriting one. */
    overridden?: boolean;
    /** Return to the inherited value; offered only when the value is overridden. */
    onReset?: () => void;
    resetLabel?: string;
}

/**
 * One setting with its inheritance: where the value comes from, and a way back to the inherited one (ADR-0026; values flow
 * down the org tree and a unit may override only the allowed keys).
 */
export function SettingRow({
    label,
    description,
    control,
    controlId,
    source,
    overridden = false,
    onReset,
    resetLabel = 'Reset to the inherited value',
    className,
    ...props
}: SettingRowProps) {
    return (
        <div
            className={cn('grid grid-cols-1 gap-3 p-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', className)}
            {...props}
        >
            <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={controlId} className="font-medium">
                    {label}
                </label>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
                <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                        className={cn(
                            'rounded-full border px-2',
                            overridden
                                ? 'border-status-info/50 bg-status-info-bg text-status-info-fg'
                                : 'bg-muted text-muted-foreground'
                        )}
                    >
                        {source}
                    </span>
                    {overridden && onReset && (
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={onReset}>
                            <RotateCcw aria-hidden />
                            {resetLabel}
                        </Button>
                    )}
                </p>
            </div>
            <div className="min-w-0">{control}</div>
        </div>
    );
}
