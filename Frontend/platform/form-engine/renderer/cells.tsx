'use client';

import { Badge, StatusBadge } from '@platform/ui';
import { cellText, EMPTY, type LookupMaps } from '../Runtime/cellText';
import { getByPath } from '../Runtime/expression';
import type { TableColumn } from '../Runtime/types';

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * A table cell as UI, on the design system: the shared text formatting (dates, currency, names for ids), statuses as coloured
 * badges, lists and files as badges. Used by the DataTable field and the data viewer's table.
 */
export function CellValue({ col, row, lookups }: { col: TableColumn; row: unknown; lookups: LookupMaps }) {
    const v = getByPath(row, col.field);
    if (blank(v) && col.type !== 'boolean' && col.type !== 'count') return <span className="text-muted-foreground">{EMPTY}</span>;
    if (col.type === 'tag') return <StatusBadge value={String(v)} label={cellText(col, row, lookups).replace(/[_-]+/g, ' ')} />;
    if (col.type === 'boolean' || col.type === 'count') return <Badge variant={v && (!Array.isArray(v) || v.length) ? 'secondary' : 'outline'}>{cellText(col, row, lookups)}</Badge>;
    if (col.type === 'tags' || col.type === 'files' || (col.type === 'lookup' && Array.isArray(v) && v.length > 1)) {
        const items = cellText(col, row, lookups).split(', ');
        return (
            <span className="inline-flex flex-wrap gap-1">
                {items.slice(0, 3).map((t, i) => (
                    <Badge key={`${t}-${i}`} variant="outline">
                        {t}
                    </Badge>
                ))}
                {items.length > 3 && <span className="text-xs text-muted-foreground">+{items.length - 3}</span>}
            </span>
        );
    }
    const text = cellText(col, row, lookups);
    return col.width ? (
        <div className="truncate" style={{ maxWidth: col.width }} title={text}>
            {text}
        </div>
    ) : (
        <>{text}</>
    );
}
