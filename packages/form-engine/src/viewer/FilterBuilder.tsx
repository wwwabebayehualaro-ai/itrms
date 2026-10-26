'use client';

import { useMemo, useState } from 'react';
import { Check, Filter, Plus, X } from 'lucide-react';
import {
    Badge,
    Button,
    Combobox,
    DatePicker,
    EthiopianDatePicker,
    IconButton,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    TagsInput,
    ToggleGroup,
    ToggleGroupItem
} from '@itrms/ui';
import type { EngineMessageKey, EngineTranslate } from '../core/messages';
import { useEngineText } from '../host/text';
import type { Labeler } from './labels';
import type { Condition, FilterGroup, Op, ViewField, ViewSchema } from './types';

const OP_LABEL: Record<Op, EngineMessageKey> = {
    eq: 'form-engine.viewer.op.eq',
    ne: 'form-engine.viewer.op.ne',
    contains: 'form-engine.viewer.op.contains',
    ncontains: 'form-engine.viewer.op.ncontains',
    starts: 'form-engine.viewer.op.starts',
    in: 'form-engine.viewer.op.in',
    nin: 'form-engine.viewer.op.nin',
    gt: 'form-engine.viewer.op.gt',
    gte: 'form-engine.viewer.op.gte',
    lt: 'form-engine.viewer.op.lt',
    lte: 'form-engine.viewer.op.lte',
    between: 'form-engine.viewer.op.between',
    has: 'form-engine.viewer.op.has',
    hasany: 'form-engine.viewer.op.hasany',
    empty: 'form-engine.viewer.op.empty',
    notempty: 'form-engine.viewer.op.notempty'
};
const DATE_OP_LABEL: Partial<Record<Op, EngineMessageKey>> = {
    eq: 'form-engine.viewer.opDate.eq',
    gt: 'form-engine.viewer.opDate.gt',
    gte: 'form-engine.viewer.opDate.gte',
    lt: 'form-engine.viewer.opDate.lt',
    lte: 'form-engine.viewer.opDate.lte'
};
export const opLabel = (f: ViewField | undefined, op: Op, t: EngineTranslate) =>
    t((f && (f.kind === 'date' || f.kind === 'datetime') ? DATE_OP_LABEL[op] : undefined) ?? OP_LABEL[op]);

const NO_VALUE: Op[] = ['empty', 'notempty'];
const LIST_OPS: Op[] = ['in', 'nin', 'hasany'];

/** Fields the filter can use: everything with at least one operator. */
export const filterableFields = (schema: ViewSchema) => schema.fields.filter((f) => f.ops.length > 0);

const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s?: unknown) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)
        ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
        : null;

/** A condition that can be sent: has every value its operator needs. */
export function isComplete(c: Condition): boolean {
    if (NO_VALUE.includes(c.op)) return true;
    if (c.op === 'between')
        return (
            Array.isArray(c.value) &&
            c.value.length === 2 &&
            c.value.every((v) => v !== null && v !== undefined && v !== '')
        );
    if (LIST_OPS.includes(c.op)) return Array.isArray(c.value) && c.value.length > 0;
    return c.value !== null && c.value !== undefined && c.value !== '';
}

/** "Amount at least $100" - for the chips under the toolbar. */
export function describeCondition(c: Condition, schema: ViewSchema, labeler: Labeler): string {
    const f = schema.fields.find((x) => x.key === c.field);
    const label = f?.label ?? c.field;
    const { t } = labeler;
    if (NO_VALUE.includes(c.op))
        return t('form-engine.viewer.filters.conditionNoValue', { label, op: t(OP_LABEL[c.op]) });
    const vals = Array.isArray(c.value) ? c.value : [c.value];
    const shown = vals.map((v) =>
        typeof v === 'boolean'
            ? t(v ? 'form-engine.core.print.yes' : 'form-engine.core.print.no')
            : labeler.text(c.field, v)
    );
    return t('form-engine.viewer.filters.condition', {
        label,
        op: opLabel(f, c.op, t),
        value:
            c.op === 'between'
                ? t('form-engine.viewer.filters.betweenValues', { from: shown[0] ?? '', to: shown[1] ?? '' })
                : shown.join(', ')
    });
}

/** A number box that keeps what is typed until it is a number ("1." on the way to "1.5"). */
function NumberBox({
    value,
    onChange,
    label,
    placeholder
}: {
    value: unknown;
    onChange: (n: number | null) => void;
    label: string;
    placeholder: string;
}) {
    const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
    // the typed text, unless the value was changed from outside (cleared, or set to another number)
    const partial = text === '' || text === '-' || text === '.';
    const shown =
        typeof value === 'number' ? (!partial && Number(text) === value ? text : String(value)) : partial ? text : '';
    return (
        <Input
            inputMode="decimal"
            className="w-32"
            aria-label={label}
            placeholder={placeholder}
            value={shown}
            onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
                setText(raw);
                const n = raw === '' || raw === '-' || raw === '.' ? null : Number(raw);
                onChange(n === null || Number.isNaN(n) ? null : n);
            }}
        />
    );
}

function ValueEditor({
    field,
    op,
    value,
    onChange,
    labeler
}: {
    field: ViewField;
    op: Op;
    value: unknown;
    onChange: (v: unknown) => void;
    labeler: Labeler;
}) {
    if (NO_VALUE.includes(op)) return null;
    const { t } = labeler;
    const options = labeler.options(field.key);
    const label = t('form-engine.viewer.filters.valueOf', { label: field.label });
    const part = (word: EngineMessageKey) =>
        t('form-engine.viewer.filters.labelled', { label: field.label, part: t(word) });

    if (field.kind === 'boolean')
        return (
            <ToggleGroup
                type="single"
                variant="outline"
                value={value === true ? 'yes' : value === false ? 'no' : ''}
                onValueChange={(v) => v && onChange(v === 'yes')}
                aria-label={label}
            >
                <ToggleGroupItem value="yes" className="px-3">
                    {t('form-engine.core.print.yes')}
                </ToggleGroupItem>
                <ToggleGroupItem value="no" className="px-3">
                    {t('form-engine.core.print.no')}
                </ToggleGroupItem>
            </ToggleGroup>
        );

    if (field.kind === 'date' || field.kind === 'datetime' || field.key === 'created_at') {
        const ethiopian = field.type === 'EthDate';
        const cal = (v: unknown, set: (d: string | null) => void, word: EngineMessageKey) =>
            ethiopian ? (
                <EthiopianDatePicker
                    value={typeof v === 'string' ? v : null}
                    onChange={set}
                    labels={{
                        placeholder: t(word),
                        previousMonth: t('form-engine.renderer.ethDate.previousMonth'),
                        nextMonth: t('form-engine.renderer.ethDate.nextMonth'),
                        clear: t('form-engine.renderer.ethDate.clear'),
                        month: t('form-engine.renderer.ethDate.month'),
                        year: t('form-engine.renderer.ethDate.year')
                    }}
                    aria-label={part(word)}
                    className="w-44"
                />
            ) : (
                <DatePicker
                    value={parseYmd(v)}
                    onChange={(d) => set(d ? ymd(d) : null)}
                    placeholder={t(word)}
                    aria-label={part(word)}
                    className="w-40"
                />
            );
        if (op === 'between') {
            const pair = Array.isArray(value) ? value : [null, null];
            return (
                <span className="flex items-center gap-2">
                    {cal(pair[0], (d) => onChange([d, pair[1] ?? null]), 'form-engine.viewer.filters.from')}
                    {cal(pair[1], (d) => onChange([pair[0] ?? null, d]), 'form-engine.viewer.filters.to')}
                </span>
            );
        }
        return cal(value, onChange, 'form-engine.viewer.filters.date');
    }

    if (field.kind === 'number') {
        if (op === 'between') {
            const pair = Array.isArray(value) ? value : [null, null];
            return (
                <span className="flex items-center gap-2">
                    <NumberBox
                        value={pair[0]}
                        onChange={(n) => onChange([n, pair[1] ?? null])}
                        label={part('form-engine.viewer.filters.from')}
                        placeholder={t('form-engine.viewer.filters.from')}
                    />
                    <NumberBox
                        value={pair[1]}
                        onChange={(n) => onChange([pair[0] ?? null, n])}
                        label={part('form-engine.viewer.filters.to')}
                        placeholder={t('form-engine.viewer.filters.to')}
                    />
                </span>
            );
        }
        return (
            <NumberBox
                value={value}
                onChange={onChange}
                label={part('form-engine.viewer.filters.value')}
                placeholder={t('form-engine.viewer.filters.value')}
            />
        );
    }

    if (options.length && field.kind !== 'text') {
        if (LIST_OPS.includes(op))
            return (
                <Combobox
                    multiple
                    options={options}
                    value={Array.isArray(value) ? value : []}
                    onChange={onChange}
                    placeholder={t('form-engine.viewer.filters.choose')}
                    searchable
                    aria-label={label}
                    className="w-72"
                />
            );
        return (
            <Combobox
                options={options}
                value={value ?? null}
                onChange={onChange}
                placeholder={t('form-engine.viewer.filters.choose')}
                searchable
                aria-label={label}
                className="w-56"
            />
        );
    }

    if (LIST_OPS.includes(op))
        return (
            <TagsInput
                value={Array.isArray(value) ? (value as string[]) : []}
                onChange={onChange}
                placeholder={t('form-engine.viewer.filters.typeEnter')}
                aria-label={label}
                className="w-72"
            />
        );
    return (
        <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('form-engine.viewer.filters.value')}
            className="w-56"
            aria-label={label}
        />
    );
}

interface FilterBuilderProps {
    schema: ViewSchema;
    labeler: Labeler;
    value: FilterGroup;
    onApply: (filter: FilterGroup) => void;
}

/**
 * Filter editor generated from the form's own fields: the field list, the operators each field supports and the right input
 * per kind (people pickers, option lists, number/date ranges, yes/no) all come from the view schema. Edits are a draft until Apply.
 */
export function FilterBuilder({ schema, labeler, value, onApply }: FilterBuilderProps) {
    const { t } = useEngineText();
    const [open, setOpen] = useState(false);
    const fields = useMemo(() => filterableFields(schema), [schema]);
    const [draft, setDraft] = useState<FilterGroup>(value);

    const conditions = draft.items.filter((i): i is Condition => !('items' in i));
    const set = (idx: number, change: Partial<Condition>) =>
        setDraft({ ...draft, items: conditions.map((c, i) => (i === idx ? { ...c, ...change } : c)) });
    const add = () => {
        const f = fields[0];
        const op = f?.ops[0];
        if (f && op) setDraft({ ...draft, items: [...conditions, { field: f.key, op }] });
    };
    const apply = () => {
        onApply({ ...draft, items: conditions.filter(isComplete) });
        setOpen(false);
    };
    const count = value.items.length;
    const fieldOptions = fields.map((x) => ({ label: x.label, value: x.key }));

    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (o) setDraft(value); // the editor starts from what is applied
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={count ? 'secondary' : 'outline'}
                    aria-label={t('form-engine.viewer.filters.button')}
                >
                    <Filter />
                    {t('form-engine.viewer.filters.button')}
                    {count > 0 && <Badge className="ml-0.5 h-5 min-w-5 px-1">{count}</Badge>}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-[min(96vw,48rem)]"
                aria-label={t('form-engine.viewer.filters.title')}
            >
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{t('form-engine.viewer.filters.matching')}</span>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            value={draft.op}
                            onValueChange={(v) => v && setDraft({ ...draft, op: v as FilterGroup['op'] })}
                            aria-label={t('form-engine.viewer.filters.matchLabel')}
                        >
                            <ToggleGroupItem value="and" className="px-3">
                                {t('form-engine.viewer.filters.all')}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="or" className="px-3">
                                {t('form-engine.viewer.filters.any')}
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <span>{t('form-engine.viewer.filters.ofThese')}</span>
                    </div>
                    {conditions.length === 0 && (
                        <span className="text-sm text-muted-foreground">{t('form-engine.viewer.filters.none')}</span>
                    )}
                    {conditions.map((c, i) => {
                        const f = fields.find((x) => x.key === c.field) ?? fields[0];
                        if (!f) return null;
                        return (
                            <div key={i} className="flex flex-wrap items-center gap-2" data-condition={i}>
                                <Combobox
                                    options={fieldOptions}
                                    value={c.field}
                                    onChange={(key) => {
                                        const nf = fields.find((x) => x.key === key);
                                        if (nf) set(i, { field: nf.key, op: nf.ops[0], value: undefined });
                                    }}
                                    searchable
                                    aria-label={t('form-engine.viewer.filters.field')}
                                    className="w-48"
                                />
                                <Combobox
                                    options={f.ops.map((op) => ({ label: opLabel(f, op, t), value: op }))}
                                    value={c.op}
                                    onChange={(op) =>
                                        op &&
                                        set(i, {
                                            op,
                                            value:
                                                LIST_OPS.includes(op) !== LIST_OPS.includes(c.op) ||
                                                op === 'between' ||
                                                c.op === 'between'
                                                    ? undefined
                                                    : c.value
                                        })
                                    }
                                    searchable={false}
                                    aria-label={t('form-engine.viewer.filters.operator')}
                                    className="w-44"
                                />
                                <ValueEditor
                                    field={f}
                                    op={c.op}
                                    value={c.value}
                                    onChange={(v) => set(i, { value: v })}
                                    labeler={labeler}
                                />
                                <IconButton
                                    label={t('form-engine.viewer.filters.removeCondition')}
                                    onClick={() => setDraft({ ...draft, items: conditions.filter((_, j) => j !== i) })}
                                >
                                    <X />
                                </IconButton>
                                {f.indexed === false && (
                                    // no index serves it under RLS: it reads every request in view (ADR-0035)
                                    <span className="basis-full text-xs text-muted-foreground" data-unindexed>
                                        {t('form-engine.viewer.filters.unindexed', { label: f.label })}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
                        <Button type="button" variant="ghost" onClick={add}>
                            <Plus />
                            {t('form-engine.viewer.filters.add')}
                        </Button>
                        <span className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setDraft({ op: 'and', items: [] });
                                    onApply({ op: 'and', items: [] });
                                    setOpen(false);
                                }}
                            >
                                {t('form-engine.viewer.filters.clear')}
                            </Button>
                            <Button type="button" onClick={apply}>
                                <Check />
                                {t('form-engine.viewer.filters.apply')}
                            </Button>
                        </span>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
