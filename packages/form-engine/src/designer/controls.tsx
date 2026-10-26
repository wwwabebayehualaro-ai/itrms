'use client';

/** Editors the inspector is made of, on the design system: numbers, option lists, conditions, table columns. */
import { useState, type ComponentProps } from 'react';
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
import type { EngineMessageKey } from '../core/messages';
import { useEngineText } from '../host/text';
import {
    REQUIRED_TEXT_LANGUAGES,
    formTextIn,
    ownText,
    setTextIn,
    type FormText,
    type VisibilityCondition
} from '@itrms/schemas';
import { keySourceOf } from './document';
import type { ColumnType, StoredTableColumn } from '@itrms/schemas';

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
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return list;
    next[i] = b;
    next[j] = a;
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
    const { t } = useEngineText();
    return (
        <span className="flex shrink-0">
            <IconButton
                label={t('form-engine.settings.controls.row.moveUp', { what })}
                size="icon-xs"
                disabled={i === 0}
                onClick={() => onMove(-1)}
            >
                <ArrowUp />
            </IconButton>
            <IconButton
                label={t('form-engine.settings.controls.row.moveDown', { what })}
                size="icon-xs"
                disabled={i === count - 1}
                onClick={() => onMove(1)}
            >
                <ArrowDown />
            </IconButton>
            <IconButton
                label={t('form-engine.settings.controls.row.remove', { what })}
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={onRemove}
            >
                <X />
            </IconButton>
        </span>
    );
}

// ---- texts in a language ------------------------------------------------------------------------------------------------
/**
 * A box for one text of a form in the builder's language: it shows what that language has of its own, the text it falls
 * back to as the placeholder (so a missing translation is visible, not blank), and "Missing" while a required language
 * (Amharic, English) has none of a text that exists in another.
 */
export function LangInput({
    text,
    language,
    plainAs,
    onText,
    placeholder,
    hint = true,
    ...rest
}: {
    text: unknown;
    language: string;
    plainAs: string;
    onText: (value: string) => void;
    placeholder?: string;
    hint?: boolean;
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'placeholder'>) {
    const { t } = useEngineText();
    const own = ownText(text, language, plainAs);
    const fallback = formTextIn(text, language);
    const missing = own === '' && !!fallback && (REQUIRED_TEXT_LANGUAGES as readonly string[]).includes(language);
    return (
        <>
            <Input
                {...rest}
                value={own}
                placeholder={own === '' ? fallback || placeholder : placeholder}
                onChange={(e) => onText(e.target.value)}
            />
            {hint && missing && (
                <p className="text-xs text-status-warning-fg" data-missing>
                    {t('form-engine.settings.controls.missing')}
                </p>
            )}
        </>
    );
}

// ---- options ------------------------------------------------------------------------------------------------------------
/** One stored option: its label in every language and the value stored; any other key (`disabled`, `items`) is kept as it is. */
export interface OptionRow {
    label?: FormText;
    value?: string | number;
    [key: string]: unknown;
}

/** "Sick leave" -> "sick_leave": the stored value proposed for a new option. */
export const valueFromLabel = (label: string) =>
    label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

/**
 * The choices of a field. The value is what is stored in a request (and filtered on); it follows the English (or plain)
 * label until it is edited, so "Sick leave" stores `sick_leave`. A label without letters (Amharic) never makes a value:
 * a new option gets `option_<n>`, a placeholder that follows the first label with letters written in the authoring
 * language; an option with a value of its own keeps it. Editing a label changes that language's text only.
 */
const hasLatinLetter = (v: string): boolean => [...v].some((c) => c >= 'a' && c <= 'z');
/** `option_<n>`: the value an option gets while its label gives none. */
const isPlaceholderValue = (v: string): boolean => {
    const n = v.startsWith('option_') ? v.slice('option_'.length) : '';
    return n.length > 0 && [...n].every((c) => c >= '0' && c <= '9');
};

/** The first `option_<n>` no option stores yet (an option whose label gives no value of its own). */
function freeValue(rows: readonly OptionRow[]): string {
    const taken = new Set(rows.map((r) => String(r.value)));
    let n = rows.length;
    while (taken.has(`option_${n}`)) n++;
    return `option_${n}`;
}

export function OptionsEditor({
    value,
    onChange,
    language = 'am',
    plainAs = language
}: {
    value: OptionRow[];
    onChange: (rows: OptionRow[]) => void;
    /** The language the labels are written in, and the one a plain-string label was written in. */
    language?: string;
    plainAs?: string;
}) {
    const { t } = useEngineText();
    const rows = value ?? [];
    const set = (i: number, patch: Partial<OptionRow>) =>
        onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const edit = (i: number, r: OptionRow, typed: string) => {
        const label = setTextIn(r.label, language, typed, plainAs);
        const before = keySourceOf(r.label);
        // a translation never changes what an answer stores: the value follows the label only while it is written in
        // the authoring language (and still equals the value made from it), or while the option has none
        // a label without Latin letters (Amharic, perhaps with a number) gives no value of its own
        const placeholder = !hasLatinLetter(valueFromLabel(before)) && isPlaceholderValue(String(r.value));
        const follows =
            r.value === undefined ||
            r.value === '' ||
            (language === plainAs && (String(r.value) === valueFromLabel(before) || placeholder));
        const proposed = valueFromLabel(keySourceOf(label));
        const next: OptionRow = { ...r };
        if (label === undefined) delete next.label;
        else next.label = label;
        if (follows && keySourceOf(label) !== before) {
            if (proposed !== '' && !rows.some((x, j) => j !== i && String(x.value) === proposed)) next.value = proposed;
            else if (r.value === undefined || r.value === '') next.value = freeValue(rows);
        }
        onChange(rows.map((x, j) => (j === i ? next : x)));
    };
    return (
        <div className="flex flex-col gap-2" data-options-editor>
            {rows.length > 0 && (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
                    <span>{t('form-engine.settings.controls.options.shownAs')}</span>
                    <span>{t('form-engine.settings.controls.options.storedAs')}</span>
                    <span className="w-[4.5rem]" />
                </div>
            )}
            {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2" data-option={i}>
                    <div className="flex flex-col gap-0.5">
                        <LangInput
                            text={r.label}
                            language={language}
                            plainAs={plainAs}
                            aria-label={t('form-engine.settings.controls.options.label', { n: String(i + 1) })}
                            onText={(typed) => edit(i, r, typed)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && i === rows.length - 1) {
                                    e.preventDefault();
                                    onChange([...rows, { label: '', value: '' }]);
                                }
                            }}
                            autoFocus={i === rows.length - 1 && !formTextIn(r.label, language)}
                        />
                    </div>
                    <Input
                        value={String(r.value ?? '')}
                        aria-label={t('form-engine.settings.controls.options.value', { n: String(i + 1) })}
                        className="font-mono text-xs"
                        onChange={(e) => set(i, { value: e.target.value })}
                    />
                    <RowButtons
                        i={i}
                        count={rows.length}
                        what={t('form-engine.settings.controls.what.option', { n: String(i + 1) })}
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
                {t('form-engine.settings.controls.options.add')}
            </Button>
        </div>
    );
}

// ---- conditions ---------------------------------------------------------------------------------------------------------
const OPS: Array<{ value: string; label: EngineMessageKey }> = [
    { value: 'eq', label: 'form-engine.settings.controls.op.eq' },
    { value: 'neq', label: 'form-engine.settings.controls.op.neq' },
    { value: 'gt', label: 'form-engine.settings.controls.op.gt' },
    { value: 'gte', label: 'form-engine.settings.controls.op.gte' },
    { value: 'lt', label: 'form-engine.settings.controls.op.lt' },
    { value: 'lte', label: 'form-engine.settings.controls.op.lte' },
    { value: 'contains', label: 'form-engine.settings.controls.op.contains' },
    { value: 'startsWith', label: 'form-engine.settings.controls.op.startsWith' },
    { value: 'endsWith', label: 'form-engine.settings.controls.op.endsWith' },
    { value: 'empty', label: 'form-engine.settings.controls.op.empty' },
    { value: 'notEmpty', label: 'form-engine.settings.controls.op.notEmpty' },
    { value: 'in', label: 'form-engine.settings.controls.op.in' },
    { value: 'notIn', label: 'form-engine.settings.controls.op.notIn' },
    { value: 'regex', label: 'form-engine.settings.controls.op.regex' }
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
    const { t } = useEngineText();
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
                aria-label={t('form-engine.settings.controls.value')}
                placeholder={t('form-engine.settings.controls.choose')}
                className="min-w-40 flex-1"
            />
        ) : (
            <Combobox
                options={opts}
                value={c.value ?? null}
                onChange={onChange}
                aria-label={t('form-engine.settings.controls.value')}
                placeholder={t('form-engine.settings.controls.choose')}
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
                aria-label={t('form-engine.settings.controls.value')}
            >
                <ToggleGroupItem value="yes" className="px-3">
                    {t('form-engine.settings.controls.yes')}
                </ToggleGroupItem>
                <ToggleGroupItem value="no" className="px-3">
                    {t('form-engine.settings.controls.no')}
                </ToggleGroupItem>
            </ToggleGroup>
        );
    if (subject?.kind === 'number' && !list)
        return (
            <NumberInput
                value={typeof c.value === 'number' ? c.value : undefined}
                onChange={(n) => onChange(n)}
                aria-label={t('form-engine.settings.controls.value')}
                placeholder={t('form-engine.settings.controls.number')}
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
                    aria-label={t('form-engine.settings.controls.pattern')}
                    aria-invalid={!!problem}
                    placeholder="^[A-Z]{3}"
                    className="font-mono"
                />
                {problem && (
                    <p role="alert" className="text-xs text-destructive">
                        {t('form-engine.settings.controls.neverHolds', { problem })}
                    </p>
                )}
            </div>
        );
    }
    return (
        <Input
            value={showTyped(c.value)}
            onChange={(e) => onChange(parseTyped(e.target.value))}
            aria-label={t('form-engine.settings.controls.value')}
            placeholder={
                list ? '["a", "b"]' : t('form-engine.settings.controls.valueOrBinding', { binding: '{{binding}}' })
            }
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
    const { t } = useEngineText();
    const list = value ?? [];
    const commit = (next: VisibilityCondition[]) => onChange(next.length ? next : undefined);
    const patch = (i: number, p: Partial<VisibilityCondition>) =>
        commit(list.map((c, j) => (j === i ? { ...c, ...p } : c)));
    const fieldOptions = [
        ...subjects.map((s) => ({ label: s.label || s.id, value: s.id })),
        { label: t('form-engine.settings.controls.otherValue'), value: REF }
    ];
    return (
        <div className="flex flex-col gap-2" data-conditions>
            {list.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
            {list.length > 1 && (
                <div className="flex items-center gap-2 text-sm">
                    <span>{t('form-engine.settings.controls.match')}</span>
                    <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={list[0]?.logic === 'or' ? 'or' : 'and'}
                        onValueChange={(v) => v && patch(0, { logic: v as 'and' | 'or' })}
                        aria-label={t('form-engine.settings.controls.matchAllOrAny')}
                    >
                        <ToggleGroupItem value="and" className="px-3">
                            {t('form-engine.settings.controls.all')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="or" className="px-3">
                            {t('form-engine.settings.controls.any')}
                        </ToggleGroupItem>
                    </ToggleGroup>
                    <span>{t('form-engine.settings.controls.ofThese')}</span>
                </div>
            )}
            {list.map((c, i) => {
                if (c.conditions?.length)
                    return (
                        <div
                            key={i}
                            className="flex items-center justify-between rounded-md border border-dashed p-2 text-sm text-muted-foreground"
                        >
                            {t('form-engine.settings.controls.group', { count: String(c.conditions.length) })}
                            <RowButtons
                                i={i}
                                count={list.length}
                                what={t('form-engine.settings.controls.what.condition')}
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
                                aria-label={t('form-engine.settings.controls.when')}
                                placeholder={t('form-engine.settings.controls.chooseField')}
                                searchable
                                className="min-w-0 flex-1"
                            />
                            <RowButtons
                                i={i}
                                count={list.length}
                                what={t('form-engine.settings.controls.what.condition')}
                                onMove={(by) => commit(move(list, i, by))}
                                onRemove={() => commit(list.filter((_, j) => j !== i))}
                            />
                        </div>
                        {isRef && (
                            <Input
                                value={c.field}
                                onChange={(e) => patch(i, { field: e.target.value })}
                                aria-label={t('form-engine.settings.controls.reference')}
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
                                <SelectTrigger
                                    size="sm"
                                    aria-label={t('form-engine.settings.controls.comparison')}
                                    className="w-36"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {OPS.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                            {t(o.label)}
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
                {t('form-engine.settings.controls.addCondition')}
            </Button>
        </div>
    );
}

// ---- table columns ------------------------------------------------------------------------------------------------------
const COLUMN_TYPES: Array<{ value: ColumnType; label: EngineMessageKey }> = [
    { value: 'text', label: 'form-engine.settings.controls.columnType.text' },
    { value: 'number', label: 'form-engine.settings.controls.columnType.number' },
    { value: 'currency', label: 'form-engine.settings.controls.columnType.currency' },
    { value: 'date', label: 'form-engine.settings.controls.columnType.date' },
    { value: 'datetime', label: 'form-engine.settings.controls.columnType.datetime' },
    { value: 'boolean', label: 'form-engine.settings.controls.columnType.boolean' },
    { value: 'tag', label: 'form-engine.settings.controls.columnType.tag' },
    { value: 'tags', label: 'form-engine.settings.controls.columnType.tags' },
    { value: 'lookup', label: 'form-engine.settings.controls.columnType.lookup' },
    { value: 'count', label: 'form-engine.settings.controls.columnType.count' },
    { value: 'files', label: 'form-engine.settings.controls.columnType.files' }
];

/** The columns of a table field: header, where the value is in a row, how it is shown. */
export function ColumnsEditor({
    value,
    onChange,
    sources,
    language,
    plainAs
}: {
    value?: StoredTableColumn[];
    onChange: (cols: StoredTableColumn[]) => void;
    sources: Array<{ label: string; value: string }>;
    language: string;
    plainAs: string;
}) {
    const { t } = useEngineText();
    const cols = value ?? [];
    const set = (i: number, patch: Partial<StoredTableColumn>) =>
        onChange(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    return (
        <div className="flex flex-col gap-2" data-columns-editor>
            {cols.map((c, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="flex items-center gap-2">
                        <LangInput
                            text={c.header}
                            language={language}
                            plainAs={plainAs}
                            placeholder={t('form-engine.settings.controls.columns.header')}
                            hint={false}
                            aria-label={t('form-engine.settings.controls.columns.headerOf', { n: String(i + 1) })}
                            onText={(v) => set(i, { header: setTextIn(c.header, language, v, plainAs) ?? '' })}
                        />
                        <RowButtons
                            i={i}
                            count={cols.length}
                            what={t('form-engine.settings.controls.what.column', { n: String(i + 1) })}
                            onMove={(by) => onChange(move(cols, i, by))}
                            onRemove={() => onChange(cols.filter((_, j) => j !== i))}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Input
                            value={c.field}
                            placeholder={t('form-engine.settings.controls.columns.valuePath')}
                            aria-label={t('form-engine.settings.controls.columns.valuePathOf', { n: String(i + 1) })}
                            className="font-mono text-xs"
                            onChange={(e) => set(i, { field: e.target.value })}
                        />
                        <Select value={c.type ?? 'text'} onValueChange={(v) => set(i, { type: v as ColumnType })}>
                            <SelectTrigger
                                size="sm"
                                aria-label={t('form-engine.settings.controls.columns.showsOf', { n: String(i + 1) })}
                                className="w-full"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {COLUMN_TYPES.map((ct) => (
                                    <SelectItem key={ct.value} value={ct.value}>
                                        {t(ct.label)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {c.type === 'currency' && (
                        <Input
                            value={c.currency ?? ''}
                            placeholder={t('form-engine.settings.controls.columns.currency')}
                            aria-label={t('form-engine.settings.controls.columns.currencyOf', { n: String(i + 1) })}
                            onChange={(e) => set(i, { currency: e.target.value || undefined })}
                        />
                    )}
                    {(c.type === 'lookup' || c.type === 'tags') && (
                        <Combobox
                            options={sources}
                            value={c.lookupSource ?? null}
                            onChange={(v) => set(i, { lookupSource: v ?? undefined })}
                            placeholder={t('form-engine.settings.controls.columns.namesFrom')}
                            aria-label={t('form-engine.settings.controls.columns.namesFromOf', { n: String(i + 1) })}
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
                {t('form-engine.settings.controls.columns.add')}
            </Button>
        </div>
    );
}
