import type { ComponentType, ReactNode } from 'react';
import type { Labeler } from './labels';
import type { ViewRow, ViewSchema, ViewState } from './types';

/** What a view mode receives. The mode runs its own queries (a board asks for counts per stage, a calendar for one month...). */
export interface ViewModeProps {
    templateId: string;
    schema: ViewSchema;
    state: ViewState;
    patch: (change: Partial<ViewState>) => void;
    labeler: Labeler;
    /** Open a request (the record page / detail). */
    onOpen: (row: ViewRow) => void;
    /** Buttons of one request (edit, delete...), supplied by the screen that embeds the viewer. */
    rowActions?: (row: ViewRow) => ReactNode;
    emptyMessage?: string;
}

export interface ViewMode {
    id: string;
    label: string;
    /** A lucide icon component. */
    icon: ComponentType<{ className?: string }>;
    order?: number;
    /** Opens first when the link names no view (e.g. a hand-built report of this form). */
    default?: boolean;
    component: ComponentType<ViewModeProps>;
    /** Offered when this returns true (default: when the server lists the mode for the form). */
    available?: (schema: ViewSchema) => boolean;
}

const modes = new Map<string, ViewMode>();

/** Add a way of looking at submitted data. Built-in: table, cards, board, calendar, pivot, dashboard. */
export function registerViewMode(mode: ViewMode) {
    modes.set(mode.id, mode);
}

export function getViewModes(schema: ViewSchema, extra: ViewMode[] = []): ViewMode[] {
    const all = [...modes.values(), ...extra];
    return all.filter((m) => (m.available ? m.available(schema) : schema.modes.includes(m.id))).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
