'use client';

/**
 * Input field types on the design system. Each reads its settings from `field.props` (the names templates already store:
 * `placeholder`, `rows`, `min`, `max`, `mode`, `currency`, `mask`, `multiple`, `filter`, `showClear`, `showTime`, `stars`, ...)
 * and keeps the value shapes the backend stores and queries (dates without a time as "YYYY-MM-DD", choices as the option
 * value, lists as arrays, files as `{file_id, name, size, type}`).
 */
import { useId, useRef, useState } from 'react';
import { format as formatDateFns } from 'date-fns';
import { Download, Paperclip, Star, X } from 'lucide-react';
import {
    Button,
    Checkbox,
    Combobox,
    DatePicker,
    EthiopianDatePicker,
    Input,
    RadioGroup,
    RadioGroupItem,
    Slider,
    Spinner,
    Switch,
    TagsInput,
    Textarea,
    cn,
    useNotify
} from '@itrms/ui';
import { CALENDAR_LANGUAGES, type CalendarLanguage } from '@itrms/ethiopian-calendar';
import { useEngineText } from '../../host/text';
import { useFileActions } from '../../host/files';
import { formatBytes } from '../../host/format';
import { text as str } from '../../core/runtime/path';
import { numberFormatOf, parseDate, type EngineField } from '../../core';
import { defineFieldType, type ValueFieldProps } from '../kit';
import { indexOfValue, sameValue, useClearInvalid, useOptions, type OptionsState } from './options';

const p = <T,>(field: EngineField, name: string, fallback?: T): T => (field.props[name] ?? fallback) as T;
function OptionsStatus({ state }: { state: OptionsState }) {
    const { t } = useEngineText();
    return state.isApi && state.error ? (
        <p className="mt-1 flex items-center gap-2 text-xs text-destructive">
            {state.error}
            <Button type="button" variant="link" size="xs" onClick={state.retry}>
                {t('form-engine.renderer.options.retry')}
            </Button>
        </p>
    ) : null;
}

// ---- text ----------------------------------------------------------------------------------------------------------
function TextField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<string>) {
    const type = field.type === 'Password' ? 'password' : p(field, 'type') === 'email' ? 'email' : 'text';
    return (
        <Input
            id={id}
            name={field.id}
            type={type}
            value={str(value)}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={str(p(field, 'placeholder'))}
            maxLength={num(p(field, 'maxLength'))}
            autoComplete={type === 'password' ? 'new-password' : undefined}
        />
    );
}

function TextareaField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<string>) {
    return (
        <Textarea
            id={id}
            name={field.id}
            value={str(value)}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={str(p(field, 'placeholder'))}
            rows={num(p(field, 'rows')) ?? 4}
            className={field.props.autoResize === false ? undefined : 'field-sizing-content'}
        />
    );
}

const num = (v: unknown) =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);

// ---- number: formatted while not editing (grouping, currency, fraction digits), plain while typing ---------------------
function NumberField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<number | undefined | null>) {
    const [editing, setEditing] = useState<string | null>(null);
    const n = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const prefix = str(p(field, 'prefix'));
    const suffix = str(p(field, 'suffix'));
    const shown = editing ?? (n === undefined ? '' : `${prefix}${numberFormatOf(field.props).format(n)}${suffix}`);
    return (
        <Input
            id={id}
            name={field.id}
            inputMode="decimal"
            value={shown}
            placeholder={str(p(field, 'placeholder'))}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onFocus={() => setEditing(n === undefined ? '' : String(n))}
            onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
                setEditing(raw);
                const parsed = raw === '' || raw === '-' || raw === '.' ? undefined : Number(raw);
                onChange(parsed === undefined || Number.isNaN(parsed) ? null : parsed);
            }}
            onBlur={() => {
                setEditing(null);
                onBlur();
            }}
        />
    );
}

// ---- input mask: 9 digit, a letter, * letter or digit, ? the rest is optional; other characters are literals --------
export function applyMask(mask: string, input: string): string {
    const data = input.replace(/[^A-Za-z0-9]/g, '').split('');
    let out = '';
    for (let i = 0, d = 0; i < mask.length && d < data.length; i++) {
        const m = mask[i];
        if (m === '?') continue;
        const ok = m === '9' ? /\d/ : m === 'a' ? /[A-Za-z]/ : m === '*' ? /[A-Za-z0-9]/ : null;
        if (!ok) {
            out += m;
            if (data[d] === m) d++;
            continue;
        }
        while (d < data.length && !ok.test(data[d] ?? '')) d++;
        if (d < data.length) out += data[d++];
    }
    return out;
}

function MaskField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<string>) {
    const mask = str(p(field, 'mask'));
    return (
        <Input
            id={id}
            name={field.id}
            value={str(value)}
            placeholder={str(p(field, 'placeholder')) || mask.replace(/[9a*]/g, '_').replace('?', '')}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(mask ? applyMask(mask, e.target.value) : e.target.value)}
            onBlur={onBlur}
        />
    );
}

// ---- choices --------------------------------------------------------------------------------------------------------
/** One searchable picker for single and multiple choices (Dropdown, MultiSelect, AutoComplete). */
function ChoiceField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<unknown>) {
    const { t } = useEngineText();
    const state = useOptions(field);
    const multiple = field.type === 'MultiSelect' || (field.type === 'Dropdown' && Boolean(p(field, 'multiple')));
    useClearInvalid(field, state, value, onChange, multiple, disabled);
    const common = {
        id,
        options: state.options,
        placeholder:
            str(p(field, 'placeholder')) ||
            t(multiple ? 'form-engine.renderer.choice.selectMany' : 'form-engine.renderer.choice.selectOne'),
        loadingLabel: t('form-engine.renderer.choice.loading'),
        searchPlaceholder: t('form-engine.renderer.choice.search'),
        searchable: Boolean(p(field, 'filter')) || state.options.length > 7 || field.type === 'AutoComplete',
        clearable: Boolean(p(field, 'showClear')) || !field.rules.required,
        clearLabel: t('form-engine.renderer.field.clear', {
            label: field.label || t('form-engine.renderer.field.selection')
        }),
        loading: state.loading,
        disabled,
        invalid,
        'aria-describedby': describedBy,
        emptyMessage: state.emptyMessage,
        isEqual: sameValue,
        onOpenChange: (o: boolean) => !o && onBlur()
    };
    return (
        <>
            {multiple ? (
                <Combobox {...common} multiple value={Array.isArray(value) ? value : []} onChange={onChange} />
            ) : (
                <Combobox
                    {...common}
                    value={value}
                    onChange={onChange}
                    fallbackLabel={field.type === 'AutoComplete' && value ? str(value) : undefined}
                />
            )}
            <OptionsStatus state={state} />
        </>
    );
}

function RadioField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<unknown>) {
    const state = useOptions(field);
    useClearInvalid(field, state, value, onChange, false, disabled);
    const current = indexOfValue(state.options, value);
    return (
        <>
            <RadioGroup
                id={id}
                value={current >= 0 ? String(current) : ''}
                onValueChange={(v) => onChange(state.options[Number(v)]?.value)}
                onBlur={onBlur}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className="flex flex-wrap gap-x-6 gap-y-2"
            >
                {state.options.map((o, i) => (
                    <label key={`${str(o.value)}-${i}`} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={String(i)} disabled={o.disabled} id={`${id}-${i}`} />
                        {o.label}
                    </label>
                ))}
            </RadioGroup>
            <OptionsStatus state={state} />
        </>
    );
}

function CheckboxGroupField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<unknown[]>) {
    const state = useOptions(field);
    useClearInvalid(field, state, value, onChange as (v: unknown) => void, true, disabled);
    const selected = Array.isArray(value) ? value : [];
    return (
        <>
            <div
                id={id}
                role="group"
                data-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className="flex flex-wrap gap-x-6 gap-y-2"
                onBlur={onBlur}
            >
                {state.options.map((o, i) => {
                    const on = selected.some((s) => sameValue(s, o.value));
                    return (
                        <label key={`${str(o.value)}-${i}`} className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={on}
                                disabled={disabled || o.disabled}
                                onCheckedChange={(c) =>
                                    onChange(
                                        c === true
                                            ? [...selected, o.value]
                                            : selected.filter((s) => !sameValue(s, o.value))
                                    )
                                }
                            />
                            {o.label}
                        </label>
                    );
                })}
            </div>
            <OptionsStatus state={state} />
        </>
    );
}

const InlineLabel = ({ field, htmlFor }: { field: EngineField; htmlFor: string }) => (
    <label htmlFor={htmlFor} className="text-sm">
        {field.label}
        {field.rules.required && <span className="ml-1 text-destructive">*</span>}
    </label>
);

function CheckboxField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<boolean>) {
    return (
        <div className="flex items-center gap-2">
            <Checkbox
                id={id}
                checked={value === true}
                onCheckedChange={(c) => onChange(c === true)}
                onBlur={onBlur}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
            />
            <InlineLabel field={field} htmlFor={id} />
        </div>
    );
}

function SwitchField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<boolean>) {
    return (
        <div className="flex items-center gap-2">
            <Switch
                id={id}
                checked={value === true}
                onCheckedChange={(c) => onChange(c)}
                onBlur={onBlur}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
            />
            <InlineLabel field={field} htmlFor={id} />
        </div>
    );
}

// ---- dates ----------------------------------------------------------------------------------------------------------
/** The builder's date format (`mm/dd/yy`, `dd.mm.yy`, `M d, yy`) in date-fns tokens. */
export function toDateFnsFormat(fmt: string): string {
    return fmt.replace(
        /yy|y|mm|m|MM|M|dd|d|DD|D|o{1,2}/g,
        (t) =>
            ({
                yy: 'yyyy',
                y: 'yy',
                mm: 'MM',
                m: 'M',
                MM: 'MMMM',
                M: 'MMM',
                dd: 'dd',
                d: 'd',
                DD: 'EEEE',
                D: 'EEE',
                oo: 'DDD',
                o: 'D'
            })[t] ?? t
    );
}
const dayString = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function DateField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<unknown>) {
    const { t } = useEngineText();
    const withTime = Boolean(p(field, 'showTime'));
    const fmt = toDateFnsFormat(str(p(field, 'dateFormat')) || 'mm/dd/yy');
    const timeFmt = p(field, 'hourFormat') === '12' ? 'h:mm a' : 'HH:mm';
    return (
        <DatePicker
            id={id}
            value={parseDate(value)}
            onChange={(d) => onChange(d ? (withTime ? d.toISOString() : dayString(d)) : null)}
            withTime={withTime}
            min={parseDate(field.rules.minDate)}
            max={parseDate(field.rules.maxDate)}
            formatLabel={(d) => formatDateFns(d, fmt) + (withTime ? ` ${formatDateFns(d, timeFmt)}` : '')}
            placeholder={str(p(field, 'placeholder')) || t('form-engine.renderer.date.placeholder')}
            timeLabel={t('form-engine.renderer.date.time')}
            disabled={disabled}
            invalid={invalid}
            aria-describedby={describedBy}
            onOpenChange={(o) => !o && onBlur()}
        />
    );
}

/** A day picked on the Ethiopian calendar, stored as the Gregorian `YYYY-MM-DD` (task 0.17b). */
function EthDateField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<unknown>) {
    const { language, t } = useEngineText();
    const calendar: CalendarLanguage = (CALENDAR_LANGUAGES as readonly string[]).includes(language)
        ? (language as CalendarLanguage)
        : 'am';
    const labels = {
        placeholder: t('form-engine.renderer.ethDate.placeholder'),
        previousMonth: t('form-engine.renderer.ethDate.previousMonth'),
        nextMonth: t('form-engine.renderer.ethDate.nextMonth'),
        clear: t('form-engine.renderer.ethDate.clear'),
        month: t('form-engine.renderer.ethDate.month'),
        year: t('form-engine.renderer.ethDate.year')
    };
    const placeholder = str(p(field, 'placeholder'));
    return (
        <EthiopianDatePicker
            id={id}
            value={typeof value === 'string' ? value : null}
            onChange={(v) => onChange(v)}
            labels={placeholder ? { ...labels, placeholder } : labels}
            language={calendar}
            min={typeof field.rules.minDate === 'string' ? field.rules.minDate : undefined}
            max={typeof field.rules.maxDate === 'string' ? field.rules.maxDate : undefined}
            disabled={disabled}
            invalid={invalid}
            aria-describedby={describedBy}
            onOpenChange={(o) => !o && onBlur()}
        />
    );
}

// ---- slider, rating, tags, colour -------------------------------------------------------------------------------------
function SliderField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    describedBy
}: ValueFieldProps<number | number[]>) {
    const min = num(p(field, 'min')) ?? 0;
    const max = num(p(field, 'max')) ?? 100;
    const range = Boolean(p(field, 'range'));
    const current = range ? (Array.isArray(value) ? value : [min, max]) : [typeof value === 'number' ? value : min];
    return (
        <div className="flex items-center gap-4">
            <Slider
                id={id}
                className="flex-1"
                min={min}
                max={max}
                step={num(p(field, 'step')) ?? 1}
                value={current}
                onValueChange={(v) => onChange(range ? v : (v[0] ?? min))}
                onBlur={onBlur}
                disabled={disabled}
                aria-describedby={describedBy}
                orientation={p(field, 'orientation') === 'vertical' ? 'vertical' : 'horizontal'}
            />
            <span className="min-w-14 text-right text-sm font-medium tabular-nums">{current.join(' – ')}</span>
        </div>
    );
}

function RatingField({ field, id, value, onChange, onBlur, disabled, describedBy }: ValueFieldProps<number | null>) {
    const { t } = useEngineText();
    const stars = num(p(field, 'stars')) ?? 5;
    const current = typeof value === 'number' ? value : 0;
    return (
        <div
            id={id}
            role="radiogroup"
            aria-describedby={describedBy}
            className="flex items-center gap-1"
            onBlur={onBlur}
        >
            {Array.from({ length: stars }, (_, i) => i + 1).map((n) => (
                <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={current === n}
                    aria-label={t('form-engine.renderer.rating.value', { number: String(n), total: String(stars) })}
                    disabled={disabled}
                    onClick={() => onChange(n === current && p(field, 'cancel') === true ? null : n)}
                    className="rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                    <Star
                        className={cn(
                            'size-5',
                            n <= current ? 'fill-status-warning text-status-warning' : 'text-muted-foreground'
                        )}
                    />
                </button>
            ))}
            {p(field, 'cancel') === true && current > 0 && !disabled && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('form-engine.renderer.rating.clear')}
                    onClick={() => onChange(null)}
                >
                    <X />
                </Button>
            )}
        </div>
    );
}

function ChipsField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<string[]>) {
    const { t } = useEngineText();
    return (
        <TagsInput
            id={id}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            separator={str(p(field, 'separator')) || ','}
            placeholder={str(p(field, 'placeholder')) || t('form-engine.renderer.chips.placeholder')}
            disabled={disabled}
            invalid={invalid}
            aria-describedby={describedBy}
        />
    );
}

function ColorField({ field, id, value, onChange, onBlur, disabled, describedBy }: ValueFieldProps<string>) {
    // stored without '#', as the original colour picker did
    return (
        <Input
            id={id}
            name={field.id}
            type="color"
            className="h-(--field-height) w-16 p-1"
            value={`#${str(value).replace(/^#/, '') || '000000'}`}
            onChange={(e) => onChange(e.target.value.replace(/^#/, ''))}
            onBlur={onBlur}
            disabled={disabled}
            aria-describedby={describedBy}
        />
    );
}

// ---- files: uploaded right away, the value keeps a reference per file ----------------------------------------------
export interface StoredFileRef {
    file_id: string;
    name: string;
    size: number;
    type: string;
}

function FileField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<StoredFileRef[]>) {
    const { uploadFile, downloadFile } = useFileActions();
    const { t } = useEngineText();
    const notify = useNotify();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const files = (Array.isArray(value) ? value : []).filter(
        (f): f is StoredFileRef => !!f && typeof f === 'object' && 'file_id' in f
    );
    const multiple = Boolean(p(field, 'multiple'));
    const maxSize = num(p(field, 'maxFileSize')) ?? 2_000_000;
    const inputId = useId();

    const upload = async (chosen: File[]) => {
        const tooBig = chosen.filter((f) => f.size > maxSize);
        if (tooBig.length)
            notify.error(
                t('form-engine.renderer.files.tooLarge', {
                    names: tooBig.map((f) => f.name).join(', '),
                    size: formatBytes(maxSize)
                })
            );
        const ok = chosen.filter((f) => f.size <= maxSize);
        if (!ok.length) return;
        setBusy(true);
        try {
            const added: StoredFileRef[] = [];
            for (const file of ok) {
                const r = await uploadFile({ file }); // a failure is toasted by the upload mutation
                added.push({ file_id: r.file_id, name: r.filename, size: r.size, type: r.content_type });
            }
            onChange(multiple ? [...files, ...added] : added);
        } catch {
            /* already reported */
        } finally {
            setBusy(false);
            onBlur();
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <input
                ref={input}
                id={inputId}
                type="file"
                hidden
                disabled={disabled}
                multiple={multiple}
                accept={str(p(field, 'accept')) || undefined}
                onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void upload(chosen);
                }}
            />
            {!disabled && (
                <div>
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        disabled={busy}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        onClick={() => input.current?.click()}
                    >
                        {busy ? <Spinner /> : <Paperclip />}
                        {busy
                            ? t('form-engine.renderer.files.uploading')
                            : str(p(field, 'chooseLabel')) || t('form-engine.renderer.files.select')}
                    </Button>
                </div>
            )}
            {files.length > 0 ? (
                <ul
                    className="flex flex-col gap-1"
                    aria-label={t('form-engine.renderer.files.listLabel', { label: field.label || field.id })}
                >
                    {files.map((f) => (
                        <li key={f.file_id} className="flex items-center gap-2 text-sm">
                            <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
                            <span>{f.name}</span>
                            <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t('form-engine.renderer.files.download', { name: f.name })}
                                onClick={() => void downloadFile(f.file_id)}
                            >
                                <Download />
                            </Button>
                            {!disabled && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t('form-engine.renderer.files.remove', { name: f.name })}
                                    onClick={() => onChange(files.filter((x) => x.file_id !== f.file_id))}
                                >
                                    <X />
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                disabled && (
                    <span className="text-sm text-muted-foreground">{t('form-engine.renderer.files.none')}</span>
                )
            )}
        </div>
    );
}

// ---- registration -----------------------------------------------------------------------------------------------------
const single = (f: EngineField) => !f.props.selectionMode || f.props.selectionMode === 'single';

defineFieldType({ kind: 'value', type: 'InputText', Render: TextField });
defineFieldType({ kind: 'value', type: 'Password', Render: TextField });
defineFieldType({ kind: 'value', type: 'InputTextarea', Render: TextareaField });
defineFieldType({ kind: 'value', type: 'InputNumber', Render: NumberField });
defineFieldType({ kind: 'value', type: 'InputMask', Render: MaskField });
defineFieldType({ kind: 'value', type: 'Dropdown', Render: ChoiceField });
defineFieldType({ kind: 'value', type: 'MultiSelect', Render: ChoiceField });
defineFieldType({ kind: 'value', type: 'AutoComplete', Render: ChoiceField, supports: (f) => !f.props.multiple });
defineFieldType({ kind: 'value', type: 'RadioButton', Render: RadioField });
defineFieldType({ kind: 'value', type: 'CheckboxGroup', Render: CheckboxGroupField });
defineFieldType({ kind: 'value', type: 'Checkbox', Render: CheckboxField, label: 'inline' });
defineFieldType({ kind: 'value', type: 'InputSwitch', Render: SwitchField, label: 'inline' });
defineFieldType({
    kind: 'value',
    type: 'Calendar',
    Render: DateField,
    supports: (f) => single(f) && !f.props.timeOnly && !f.props.view
});
defineFieldType({ kind: 'value', type: 'EthDate', Render: EthDateField });
defineFieldType({ kind: 'value', type: 'Slider', Render: SliderField });
defineFieldType({ kind: 'value', type: 'Rating', Render: RatingField });
defineFieldType({ kind: 'value', type: 'Chips', Render: ChipsField });
defineFieldType({
    kind: 'value',
    type: 'ColorPicker',
    Render: ColorField,
    supports: (f) => !f.props.format || f.props.format === 'hex'
});
defineFieldType({ kind: 'value', type: 'FileUpload', Render: FileField });
