'use client';

/** Editors the inspector is made of, on the design system: numbers, option lists, conditions, table columns. */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import {
    Button,
    Combobox,
    IconButton,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    ToggleGroup,
    ToggleGroupItem
} from '@itrms/ui';
import { explainPattern } from '../core/safePattern';
import type { VisibilityCondition } from '../core/storedTypes';
import type { ColumnType, TableColumn } from '../Runtime/types';

// ---- number -------------------------------------------------------------------------------------------------------------
/** A number box that keeps what is typed until it is a number ("1." on the way to "1.5"); empty means "not set". */
export function NumberInput({
    value,
    onChange,
    id,
    placeholder,
    className,
    'aria-label': ariaLabel
}: {
    value: number | undefined;
    onChange: (n: number | undefined) => void;
    id?: string;
    placeholder?: string;
    className?: string;
    'aria-label'?: string;
}) {
    const [text, setText] = useState(value === undefined ? '' : String(value));
    const partial = text === '' || text === '-' || text === '.' || text.endsWith('.');
    const shown = value === undefined ? (partial ? text : '') : Number(text) === value ? text : String(value);
    return (
        <Input
            id={id}
            inputMode="decimal"
            value={shown}
            placeholder={placeholder}
            className={className}
            aria-label={ariaLabel}
            onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.-]/g, '');
                setText(raw);
                const n = raw === '' || raw === '-' || raw === '.' ? undefined : Number(raw);
                onChange(n === undefined || Number.isNaN(n) ? undefined : n);
            }}
        />
    );
}

const move = <T,>(list: T[], i: number, by: -1 | 1) => {
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
};

function RowButtons({
    i,
    count,
    onMove,
    onRemove,
    what
}: {
    i: number;
    count: number;
    onMove: (by: -1 | 1) => void;
    onRemove: () => void;
    what: string;
}) {
    return (
        <span className="flex shrink-0">
            <IconButton label={`Move ${what} up`} size="icon-xs" disabled={i === 0} onClick={() => onMove(-1)}>
                <ArrowUp />
            </IconButton>
            <IconButton label={`Move ${what} down`} size="icon-xs" disabled={i === count - 1} onClick={() => onMove(1)}>
                <ArrowDown />
            </IconButton>
            <IconButton
                label={`Remove ${what}`}
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={onRemove}
            >
                <X />
            </IconButton>
        </span>
    );
}

// ---- options ------------------------------------------------------------------------------------------------------------
export interface OptionRow {
    label: string;
    value: string | number;
}

/** "Sick leave" -> "sick_leave": the stored value proposed for a new option. */
export const valueFromLabel = (label: string) =>
    label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

/**
 * The choices of a field. The value is what is stored in a request (and filtered on); it follows the label until it is edited,
 * so "Sick leave" stores `sick_leave`.
 */
export function OptionsEditor({ value, onChange }: { value: OptionRow[]; onChange: (rows: OptionRow[]) => void }) {
    const rows = value ?? [];
    const set = (i: number, patch: Partial<OptionRow>) =>
        onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    return (
        <div className="flex flex-col gap-2" data-options-editor>
            {rows.length > 0 && (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
                    <span>Shown as</span>
                    <span>Stored as</span>
                    <span className="w-[4.5rem]" />
                </div>
            )}
            {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2" data-option={i}>
                    <Input
                        value={r.label}
                        aria-label={`Option ${i + 1} label`}
                        onChange={(e) => {
                            const label = e.target.value;
                            const follows = String(r.value) === valueFromLabel(r.label) || r.value === '';
                            set(i, follows ? { label, value: valueFromLabel(label) } : { label });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && i === rows.length - 1) {
                                e.preventDefault();
                                onChange([...rows, { label: '', value: '' }]);
                            }
                        }}
                        autoFocus={i === rows.length - 1 && r.label === ''}
                    />
                    <Input
                        value={String(r.value ?? '')}
                        aria-label={`Option ${i + 1} value`}
                        className="font-mono text-xs"
                        onChange={(e) => set(i, { value: e.target.value })}
                    />
                    <RowButtons
                        i={i}
                        count={rows.length}
                        what={`option ${i + 1}`}
                        onMove={(by) => onChange(move(rows, i, by))}
                        onRemove={() => onChange(rows.filter((_, j) => j !== i))}
                    />
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onChange([...rows, { label: '', value: '' }])}
            >
                <Plus />
                Add option
            </Button>
        </div>
    );
}

// ---- conditions ---------------------------------------------------------------------------------------------------------
const OPS: Array<{ value: string; label: string }> = [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'contains', label: 'contains' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is filled in' },
    { value: 'in', label: 'is one of' },
    { value: 'notIn', label: 'is none of' },
    { value: 'regex', label: 'matches pattern' }
];
const NO_VALUE = new Set(['empty', 'notEmpty']);
const LIST_OPS = new Set(['in', 'notIn']);
const REF = '__reference__';

/** A field a condition can look at, with what the value editor needs to know about it. */
export interface ConditionSubject {
    id: string;
    label: string;
    kind: 'text' | 'number' | 'boolean' | 'choice';
    options?: Array<{ label: string; value: unknown }>;
}

/** Text typed for a value: numbers, true/false and ["a","b"] are read as such; everything else (also {{bindings}}) is text. */
const parseTyped = (raw: string): unknown => {
    if (/^(\[.*\]|true|false|null|-?\d+(\.\d+)?)$/.test(raw.trim())) {
        try {
            return JSON.parse(raw);
        } catch {
            /* text */
        }
    }
    return raw;
};
const showTyped = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

function ConditionValue({
    c,
    subject,
    onChange
}: {
    c: VisibilityCondition;
    subject?: ConditionSubject;
    onChange: (v: unknown) => void;
}) {
    if (NO_VALUE.has(c.operator)) return null;
    const list = LIST_OPS.has(c.operator);
    if (subject?.kind === 'choice' && subject.options?.length) {
        const opts = subject.options.map((o) => ({ label: o.label, value: o.value }));
        return list ? (
            <Combobox
                multiple
                options={opts}
                value={Array.isArray(c.value) ? c.value : []}
                onChange={onChange}
                aria-label="Value"
                placeholder="Choose…"
                className="min-w-40 flex-1"
            />
        ) : (
            <Combobox
                options={opts}
                value={c.value ?? null}
                onChange={onChange}
                aria-label="Value"
                placeholder="Choose…"
                className="min-w-40 flex-1"
            />
        );
    }
    if (subject?.kind === 'boolean' && !list)
        return (
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={c.value === true ? 'yes' : c.value === false ? 'no' : ''}
                onValueChange={(v) => v && onChange(v === 'yes')}
                aria-label="Value"
            >
                <ToggleGroupItem value="yes" className="px-3">
                    Yes
                </ToggleGroupItem>
                <ToggleGroupItem value="no" className="px-3">
                    No
                </ToggleGroupItem>
            </ToggleGroup>
        );
    if (subject?.kind === 'number' && !list)
        return (
            <NumberInput
                value={typeof c.value === 'number' ? c.value : undefined}
                onChange={(n) => onChange(n)}
                aria-label="Value"
                placeholder="Number"
                className="w-32"
            />
        );
    if (c.operator === 'regex') {
        // An unusable pattern never matches, which would silently hide or disable the field: say so here.
        const pattern = typeof c.value === 'string' ? c.value : '';
        const problem = pattern && !pattern.includes('{{') ? explainPattern(pattern) : null;
        return (
            <div className="flex min-w-40 flex-1 flex-col gap-1">
                <Input
                    value={pattern}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label="Pattern"
                    aria-invalid={!!problem}
                    placeholder="^[A-Z]{3}"
                    className="font-mono"
                />
                {problem && (
                    <p role="alert" className="text-xs text-destructive">
                        {problem} The condition never holds.
                    </p>
                )}
            </div>
        );
    }
    return (
        <Input
            value={showTyped(c.value)}
            onChange={(e) => onChange(parseTyped(e.target.value))}
            aria-label="Value"
            placeholder={list ? '["a", "b"]' : 'value or {{binding}}'}
            className="min-w-40 flex-1"
        />
    );
}

/**
 * When a field is shown (or enabled): a list of conditions matched all / any. A condition looks at a field of the form or at a
 * reference such as `data.customer.type`, `user.role`, `route.id`.
 */
export function ConditionsEditor({
    value,
    onChange,
    subjects,
    emptyText
}: {
    value?: VisibilityCondition[];
    onChange: (v: VisibilityCondition[] | undefined) => void;
    subjects: ConditionSubject[];
    emptyText: string;
}) {
    const list = value ?? [];
    const commit = (next: VisibilityCondition[]) => onChange(next.length ? next : undefined);
    const patch = (i: number, p: Partial<VisibilityCondition>) =>
        commit(list.map((c, j) => (j === i ? { ...c, ...p } : c)));
    const fieldOptions = [
        ...subjects.map((s) => ({ label: s.label || s.id, value: s.id })),
        { label: 'Other value (data., user., route.)…', value: REF }
    ];
    return (
        <div className="flex flex-col gap-2" data-conditions>
            {list.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
            {list.length > 1 && (
                <div className="flex items-center gap-2 text-sm">
                    <span>Match</span>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={list[0].logic === 'or' ? 'or' : 'and'}
                        onValueChange={(v) => v && patch(0, { logic: v as 'and' | 'or' })}
                        aria-label="Match all or any"
                    >
                        <ToggleGroupItem value="and" className="px-3">
                            all
                        </ToggleGroupItem>
                        <ToggleGroupItem value="or" className="px-3">
                            any
                        </ToggleGroupItem>
                    </ToggleGroup>
                    <span>of these</span>
                </div>
            )}
            {list.map((c, i) => {
                if (c.conditions?.length)
                    return (
                        <div
                            key={i}
                            className="flex items-center justify-between rounded-md border border-dashed p-2 text-sm text-muted-foreground"
                        >
                            A group of {c.conditions.length} conditions (edit it in the field&apos;s JSON)
                            <RowButtons
                                i={i}
                                count={list.length}
                                what="condition"
                                onMove={(by) => commit(move(list, i, by))}
                                onRemove={() => commit(list.filter((_, j) => j !== i))}
                            />
                        </div>
                    );
                const subject = subjects.find((s) => s.id === c.field);
                const isRef = !subject && c.field !== '';
                return (
                    <div key={i} className="flex flex-col gap-2 rounded-md border p-2" data-condition={i}>
                        <div className="flex items-center gap-2">
                            <Combobox
                                options={fieldOptions}
                                value={isRef ? REF : c.field || null}
                                onChange={(v) =>
                                    patch(i, { field: v === REF ? 'data.' : String(v ?? ''), value: undefined })
                                }
                                aria-label="When"
                                placeholder="Choose a field"
                                searchable
                                className="min-w-0 flex-1"
                            />
                            <RowButtons
                                i={i}
                                count={list.length}
                                what="condition"
                                onMove={(by) => commit(move(list, i, by))}
                                onRemove={() => commit(list.filter((_, j) => j !== i))}
                            />
                        </div>
                        {isRef && (
                            <Input
                                value={c.field}
                                onChange={(e) => patch(i, { field: e.target.value })}
                                aria-label="Reference"
                                placeholder="data.customer.type"
                                className="font-mono text-xs"
                            />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={c.operator}
                                onValueChange={(op) =>
                                    patch(i, {
                                        operator: op as VisibilityCondition['operator'],
                                        ...(LIST_OPS.has(op) !== LIST_OPS.has(c.operator) && { value: undefined })
                                    })
                                }
                            >
                                <SelectTrigger size="sm" aria-label="Comparison" className="w-36">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {OPS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <ConditionValue c={c} subject={subject} onChange={(v) => patch(i, { value: v })} />
                        </div>
                    </div>
                );
            })}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => commit([...list, { field: '', operator: 'eq', value: '' }])}
            >
                <Plus />
                Add condition
            </Button>
        </div>
    );
}

// ---- table columns ------------------------------------------------------------------------------------------------------
const COLUMN_TYPES: Array<{ value: ColumnType; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'currency', label: 'Money' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date and time' },
    { value: 'boolean', label: 'Yes / no' },
    { value: 'tag', label: 'Status' },
    { value: 'tags', label: 'List' },
    { value: 'lookup', label: 'Name from a data source' },
    { value: 'count', label: 'Count' },
    { value: 'files', label: 'Files' }
];

/** The columns of a table field: header, where the value is in a row, how it is shown. */
export function ColumnsEditor({
    value,
    onChange,
    sources
}: {
    value?: TableColumn[];
    onChange: (cols: TableColumn[]) => void;
    sources: Array<{ label: string; value: string }>;
}) {
    const cols = value ?? [];
    const set = (i: number, patch: Partial<TableColumn>) =>
        onChange(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    return (
        <div className="flex flex-col gap-2" data-columns-editor>
            {cols.map((c, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="flex items-center gap-2">
                        <Input
                            value={c.header}
                            placeholder="Header"
                            aria-label={`Column ${i + 1} header`}
                            onChange={(e) => set(i, { header: e.target.value })}
                        />
                        <RowButtons
                            i={i}
                            count={cols.length}
                            what={`column ${i + 1}`}
                            onMove={(by) => onChange(move(cols, i, by))}
                            onRemove={() => onChange(cols.filter((_, j) => j !== i))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Input
                            value={c.field}
                            placeholder="Value path, e.g. created_at"
                            aria-label={`Column ${i + 1} value path`}
                            className="font-mono text-xs"
                            onChange={(e) => set(i, { field: e.target.value })}
                        />
                        <Select value={c.type ?? 'text'} onValueChange={(v) => set(i, { type: v as ColumnType })}>
                            <SelectTrigger size="sm" aria-label={`Column ${i + 1} shows`} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {COLUMN_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {c.type === 'currency' && (
                        <Input
                            value={c.currency ?? ''}
                            placeholder="Currency, e.g. USD"
                            aria-label={`Column ${i + 1} currency`}
                            onChange={(e) => set(i, { currency: e.target.value || undefined })}
                        />
                    )}
                    {(c.type === 'lookup' || c.type === 'tags') && (
                        <Combobox
                            options={sources}
                            value={c.lookupSource ?? null}
                            onChange={(v) => set(i, { lookupSource: (v as string | null) ?? undefined })}
                            placeholder="Names from…"
                            aria-label={`Column ${i + 1} names from`}
                            clearable
                        />
                    )}
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onChange([...cols, { header: '', field: '', type: 'text' }])}
            >
                <Plus />
                Add column
            </Button>
        </div>
    );
}
