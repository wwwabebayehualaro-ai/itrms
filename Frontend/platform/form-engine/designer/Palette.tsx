'use client';

/**
 * The palette: every field type the field kit can draw (`design` in its definition), grouped and searchable. Click adds the
 * type next to the selection (or into the selected container); drag drops it where the line shows.
 */
import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search } from 'lucide-react';
import { Input, Tooltip, TooltipContent, TooltipTrigger, cn } from '@platform/ui';
import { PALETTE_GROUPS, designableTypes, type DesignMeta } from '../renderer/kit';
import { PALETTE_PREFIX } from './Canvas';
import { useDesignerActions } from './store';

export interface PaletteEntry extends DesignMeta {
    type: string;
}

/** The types offered: every type of the field kit with a `design` description. */
export function paletteEntries(): PaletteEntry[] {
    return designableTypes().map((d) => ({ ...d.design, type: d.type }));
}

function Item({ entry }: { entry: PaletteEntry }) {
    const actions = useDesignerActions();
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${entry.type}`, data: { entry } });
    const Icon = entry.icon;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    ref={setNodeRef}
                    type="button"
                    {...attributes}
                    {...listeners}
                    onClick={() => actions.add(entry.type, entry.label)}
                    className={cn('flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', isDragging && 'opacity-50')}
                    data-palette={entry.type}
                    aria-label={`Add ${entry.label}`}
                >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.label}</span>
                </button>
            </TooltipTrigger>
            {entry.hint && (
                <TooltipContent side="right" className="max-w-64">
                    {entry.hint}
                </TooltipContent>
            )}
        </Tooltip>
    );
}

export function Palette() {
    const [q, setQ] = useState('');
    const entries = useMemo(() => paletteEntries(), []);
    const shown = useMemo(() => {
        const s = q.trim().toLowerCase();
        return s ? entries.filter((e) => [e.label, e.type, e.hint ?? '', ...(e.keywords ?? [])].some((t) => t.toLowerCase().includes(s))) : entries;
    }, [entries, q]);
    return (
        <nav className="flex flex-col gap-3" aria-label="Fields to add">
            <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a field" aria-label="Find a field" className="pl-8" />
            </div>
            {PALETTE_GROUPS.map((group) => {
                const items = shown.filter((e) => e.group === group);
                if (!items.length) return null;
                return (
                    <section key={group} className="flex flex-col gap-0.5" aria-label={group}>
                        <h3 className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group}</h3>
                        <div className="flex flex-col">
                            {items.map((e) => (
                                <Item key={e.type} entry={e} />
                            ))}
                        </div>
                    </section>
                );
            })}
            {shown.length === 0 && <p className="text-sm text-muted-foreground">No field matches “{q}”.</p>}
        </nav>
    );
}
