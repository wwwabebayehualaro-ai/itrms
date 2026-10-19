'use client';

/**
 * The selected field's settings, in tabs: Field (label, key, help, width, required), Settings (generated from the type's
 * settings schema), Options or Rows (where choices / table rows come from), Rules (validation), Logic (when it shows, when it is
 * enabled, a calculated value) and JSON (everything, for the rare case nothing else covers). Every change is one undoable edit.
 * With nothing selected it shows the form's outline.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Draft } from 'immer';
import {
    Badge,
    Button,
    Combobox,
    DatePicker,
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    TagsInput,
    Textarea,
    ToggleGroup,
    ToggleGroupItem,
    cn,
    useNotify
} from '@itrms/ui';
import type { FormField } from '../core/storedTypes';
import { KEY_PATTERN } from './fieldKeys';
import { checkFormula } from '../Runtime/formula';
import type { FieldOptionsBinding, FieldRowsBinding, TableColumn } from '../Runtime/types';
import { holdsValue, parseDate, storedFieldSchema, toEngineField, type EngineField, type StoredField } from '../core';
import { getFieldType, type DesignMeta } from '../renderer/kit';
import {
    ColumnsEditor,
    ConditionsEditor,
    NumberInput,
    OptionsEditor,
    type ConditionSubject,
    type OptionRow
} from './controls';
import { ROOT, getPath, setPath } from './document';
import { SettingsForm } from './SettingsForm';
import { useDesigner, useDesignerActions } from './store';

const WIDTHS = [
    { value: '12', label: 'Full width' },
    { value: '9', label: 'Three quarters' },
    { value: '8', label: 'Two thirds' },
    { value: '6', label: 'Half' },
    { value: '4', label: 'One third' },
    { value: '3', label: 'One quarter' }
];
const NUMBERS = new Set(['InputNumber', 'Slider', 'Rating']);
const BOOLEANS = new Set(['Checkbox', 'InputSwitch']);
const day = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Row({
    id,
    label,
    help,
    error,
    children
}: {
    id?: string;
    label: string;
    help?: string;
    error?: string | null;
    children: ReactNode;
}) {
    return (
        <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {children}
            {error ? <FieldError>{error}</FieldError> : help && <FieldDescription>{help}</FieldDescription>}
        </Field>
    );
}

function SwitchRow({
    id,
    label,
    help,
    checked,
    onChange
}: {
    id: string;
    label: string;
    help?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <Field orientation="horizontal" className="items-start justify-between">
            <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                {help && <FieldDescription>{help}</FieldDescription>}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </Field>
    );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <section className="flex flex-col gap-3">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
        {children}
    </section>
);

/** Edit helpers for one field: a dotted path in the stored field, each change one (coalesced) undo step. */
function useFieldEdit(id: string) {
    const actions = useDesignerActions();
    return {
        set: (path: string, value: unknown) =>
            actions.update(id, (f) => setPath(f as Record<string, any>, path, value), `${id}:${path}`),
        apply: (recipe: (f: Draft<FormField>) => void, key: string) => actions.update(id, recipe, `${id}:${key}`)
    };
}

// ---- tabs --------------------------------------------------------------------------------------------------------------
function FieldTab({ stored, field, design }: { stored: FormField; field: EngineField; design?: DesignMeta }) {
    const { set } = useFieldEdit(stored.id);
    const actions = useDesignerActions();
    const keys = useDesigner((s) => s.doc.byId);
    const [key, setKey] = useState<string | null>(null);
    const draftKey = key ?? stored.id;
    const keyError = !KEY_PATTERN.test(draftKey)
        ? 'Start with a letter; letters, digits and _ only (max 64).'
        : draftKey !== stored.id && keys[draftKey]
          ? 'Another field already uses this key.'
          : null;
    const commitKey = () => {
        if (key !== null && !keyError && key !== stored.id) actions.rename(stored.id, key);
        setKey(null);
    };
    const value = holdsValue(field);
    const span = String(field.props.span ?? '12');
    return (
        <div className="flex flex-col gap-4">
            <Row id="insp-label" label={field.isContainer ? 'Title' : 'Label'}>
                <Input
                    id="insp-label"
                    value={stored.label ?? ''}
                    onChange={(e) => actions.relabel(stored.id, e.target.value)}
                />
            </Row>
            {value && (
                <Row
                    id="insp-key"
                    label="Key"
                    help="Name of the value in submitted data, filters and formulas. Renaming updates every rule and formula that uses it."
                    error={keyError}
                >
                    <Input
                        id="insp-key"
                        value={draftKey}
                        className="font-mono text-xs"
                        onChange={(e) => setKey(e.target.value)}
                        onBlur={commitKey}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitKey();
                            if (e.key === 'Escape') setKey(null);
                        }}
                    />
                </Row>
            )}
            {value && (
                <Row id="insp-help" label="Help text" help="A line under the field.">
                    <Input
                        id="insp-help"
                        value={String(stored.props?.helpText ?? '')}
                        onChange={(e) => set('props.helpText', e.target.value || undefined)}
                    />
                </Row>
            )}
            <Row
                id="insp-width"
                label="Width"
                help="Fields narrower than the row sit side by side (on phones everything stacks)."
            >
                <Select
                    value={WIDTHS.some((w) => w.value === span) ? span : '12'}
                    onValueChange={(v) => set('props.span', v === '12' ? undefined : Number(v))}
                >
                    <SelectTrigger id="insp-width" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {WIDTHS.map((w) => (
                            <SelectItem key={w.value} value={w.value}>
                                {w.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Row>
            {value && (
                <SwitchRow
                    id="insp-required"
                    label="Required"
                    help="The request cannot be sent without it."
                    checked={field.rules.required}
                    onChange={(v) =>
                        actions.update(stored.id, (f) => {
                            setPath(f as Record<string, any>, 'props.required', v);
                            setPath(f as Record<string, any>, 'behavior.validation.supported', true); // a rule counts only on a validated field
                        })
                    }
                />
            )}
            <SwitchRow
                id="insp-disabled"
                label="Read-only"
                help="Shown, but cannot be changed."
                checked={field.props.disabled === true}
                onChange={(v) => set('props.disabled', v || undefined)}
            />
            <Row
                id="insp-roles"
                label="Only for roles"
                help="Leave empty for everyone. Hidden from other roles, on screen and in exports."
            >
                <TagsInput
                    id="insp-roles"
                    value={(stored as FormField & { visibleToRoles?: string[] }).visibleToRoles ?? []}
                    onChange={(v) => set('visibleToRoles', v.length ? v : undefined)}
                    placeholder="e.g. hr, finance"
                />
            </Row>
            {design && <p className="text-xs text-muted-foreground">{design.hint}</p>}
        </div>
    );
}

function SettingsTab({ stored, design }: { stored: FormField; design?: DesignMeta }) {
    const { set } = useFieldEdit(stored.id);
    return (
        <SettingsForm
            schema={design?.settings}
            idPrefix={`insp-${stored.id}`}
            value={(k) => stored.props?.[k] ?? stored.data?.defaultProps?.[k]}
            own={() => true}
            onChange={(k, v) =>
                set(`props.${k}`, v === '' && stored.data?.defaultProps?.[k] === undefined ? undefined : v)
            }
        />
    );
}

function useGetSources() {
    const sources = useDesigner((s) => s.doc.runtime.dataSources);
    return useMemo(
        () =>
            sources
                .filter((d) => d.request.method === 'GET')
                .map((d) => ({ label: `${d.name || d.id} (${d.request.url})`, value: d.id })),
        [sources]
    );
}

function OptionsTab({ stored }: { stored: FormField }) {
    const { set } = useFieldEdit(stored.id);
    const sources = useGetSources();
    const binding = stored.data?.optionsBinding as FieldOptionsBinding | undefined;
    // the stored list as it is (the engine leaves blank rows out; here a new blank row must stay to be filled in)
    const raw = (stored.data?.dataSource?.staticData ??
        stored.props?.options ??
        stored.data?.defaultProps?.options ??
        []) as unknown[];
    const rows: OptionRow[] = (Array.isArray(raw) ? raw : []).map((o) =>
        o && typeof o === 'object'
            ? { label: String((o as OptionRow).label ?? ''), value: (o as OptionRow).value ?? '' }
            : { label: String(o), value: o as string | number }
    );
    const setBinding = (patch: Partial<FieldOptionsBinding> | undefined) =>
        set('data.optionsBinding', patch === undefined ? undefined : { ...binding, ...patch });
    return (
        <div className="flex flex-col gap-4">
            <ToggleGroup
                type="single"
                variant="outline"
                value={binding ? 'api' : 'static'}
                onValueChange={(v) =>
                    v === 'static'
                        ? setBinding(undefined)
                        : v === 'api' && setBinding({ dataSourceId: sources[0]?.value ?? '' })
                }
                aria-label="Where the options come from"
                className="w-full"
            >
                <ToggleGroupItem value="static" className="flex-1">
                    A fixed list
                </ToggleGroupItem>
                <ToggleGroupItem value="api" className="flex-1">
                    A data source
                </ToggleGroupItem>
            </ToggleGroup>
            {!binding ? (
                <OptionsEditor value={rows} onChange={(next) => set('data.dataSource.staticData', next)} />
            ) : (
                <>
                    <Row
                        label="Data source"
                        help={
                            sources.length
                                ? 'Fetched when the form opens.'
                                : 'Add a data source first (Data sources, at the top).'
                        }
                    >
                        <Combobox
                            options={sources}
                            value={binding.dataSourceId || null}
                            onChange={(v) => setBinding({ dataSourceId: (v as string | null) ?? '' })}
                            placeholder="Choose a data source"
                            aria-label="Data source"
                        />
                    </Row>
                    <div className="grid grid-cols-2 gap-3">
                        <Row id="insp-labelpath" label="Label from" help="Path in each record">
                            <Input
                                id="insp-labelpath"
                                value={binding.mapping?.labelPath ?? ''}
                                placeholder="name"
                                className="font-mono text-xs"
                                onChange={(e) =>
                                    setBinding({
                                        mapping: {
                                            ...binding.mapping,
                                            labelPath: e.target.value || undefined
                                        } as FieldOptionsBinding['mapping']
                                    })
                                }
                            />
                        </Row>
                        <Row id="insp-valuepath" label="Value from" help="What is stored">
                            <Input
                                id="insp-valuepath"
                                value={binding.mapping?.valuePath ?? ''}
                                placeholder="id"
                                className="font-mono text-xs"
                                onChange={(e) =>
                                    setBinding({
                                        mapping: {
                                            ...binding.mapping,
                                            valuePath: e.target.value || undefined
                                        } as FieldOptionsBinding['mapping']
                                    })
                                }
                            />
                        </Row>
                    </div>
                    <Row id="insp-emptymsg" label="Text when there are none">
                        <Input
                            id="insp-emptymsg"
                            value={binding.emptyMessage ?? ''}
                            onChange={(e) => setBinding({ emptyMessage: e.target.value || undefined })}
                        />
                    </Row>
                    <SwitchRow
                        id="insp-clear"
                        label="Drop a choice that is no longer offered"
                        help="For cascading choices (a city that depends on a country)."
                        checked={binding.clearOnInvalid !== false}
                        onChange={(v) => setBinding({ clearOnInvalid: v })}
                    />
                </>
            )}
        </div>
    );
}

function RowsTab({ stored, field }: { stored: FormField; field: EngineField }) {
    const { set } = useFieldEdit(stored.id);
    const sources = useGetSources();
    const binding = stored.data?.rowsBinding as FieldRowsBinding | undefined;
    return (
        <div className="flex flex-col gap-4">
            <Row label="Rows from" help="Each record the data source returns is one row.">
                <Combobox
                    options={sources}
                    value={binding?.dataSourceId ?? null}
                    onChange={(v) => set('data.rowsBinding', v ? { ...binding, dataSourceId: v as string } : undefined)}
                    placeholder="Fixed rows"
                    aria-label="Rows from"
                    clearable
                    clearLabel="Use fixed rows"
                />
            </Row>
            {binding && (
                <Row
                    id="insp-items"
                    label="List inside the response"
                    help="e.g. items. Empty when the source returns a list."
                >
                    <Input
                        id="insp-items"
                        value={binding.itemsPath ?? ''}
                        className="font-mono text-xs"
                        onChange={(e) =>
                            set('data.rowsBinding', { ...binding, itemsPath: e.target.value || undefined })
                        }
                    />
                </Row>
            )}
            <Section title="Columns">
                <ColumnsEditor
                    value={field.props.columns as TableColumn[] | undefined}
                    sources={sources}
                    onChange={(cols) => set('props.columns', cols)}
                />
            </Section>
        </div>
    );
}

function RulesTab({ stored, field, design }: { stored: FormField; field: EngineField; design?: DesignMeta }) {
    const { apply } = useFieldEdit(stored.id);
    const rules = design?.rules ?? [];
    const rule = (name: string) => getPath(stored, `behavior.validation.rules.${name}`);
    // a rule only counts when the field is validated: turning one on turns validation on
    const setRule = (path: string, value: unknown) =>
        apply((f) => {
            setPath(f as Record<string, any>, path, value);
            if (value !== undefined) setPath(f as Record<string, any>, 'behavior.validation.supported', true);
        }, path);
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    const sources = useGetSources();
    const remote = stored.behavior?.validation?.remote;
    return (
        <div className="flex flex-col gap-5">
            {holdsValue(field) && (
                <Section title="Required">
                    <SwitchRow
                        id="insp-req2"
                        label="Required"
                        checked={field.rules.required}
                        onChange={(v) => setRule('props.required', v)}
                    />
                    {field.rules.required && (
                        <Row id="insp-reqmsg" label="Message when empty">
                            <Input
                                id="insp-reqmsg"
                                value={String(stored.behavior?.validation?.errorMessages?.required ?? '')}
                                placeholder="This field is required"
                                onChange={(e) =>
                                    setRule('behavior.validation.errorMessages.required', e.target.value || undefined)
                                }
                            />
                        </Row>
                    )}
                </Section>
            )}
            {holdsValue(field) && !field.computed && (
                <Section title="Checked by a data source">
                    <Row
                        label="Valid when this lookup succeeds"
                        help={
                            sources.length
                                ? 'The lookup reads this field (e.g. /accounts/{{form.accountNumber}}); its error is shown here and stops submitting.'
                                : 'Add a GET data source first (Data sources, at the top).'
                        }
                    >
                        <Combobox
                            options={sources}
                            value={remote?.dataSourceId ?? null}
                            onChange={(v) =>
                                setRule(
                                    'behavior.validation.remote',
                                    v ? { ...remote, dataSourceId: v as string } : undefined
                                )
                            }
                            placeholder="Not checked"
                            clearable
                            aria-label="Checked by data source"
                        />
                    </Row>
                    {remote?.dataSourceId && (
                        <Row
                            id="insp-remotemsg"
                            label="Message when the lookup fails"
                            help="Used when the data source gives no message of its own."
                        >
                            <Input
                                id="insp-remotemsg"
                                value={remote.message ?? ''}
                                placeholder="Could not be verified"
                                onChange={(e) =>
                                    setRule('behavior.validation.remote', {
                                        ...remote,
                                        message: e.target.value || undefined
                                    })
                                }
                            />
                        </Row>
                    )}
                </Section>
            )}
            {rules.includes('length') && (
                <Section title="Length">
                    <div className="grid grid-cols-2 gap-3">
                        <Row id="insp-minlen" label="At least (characters)">
                            <NumberInput
                                id="insp-minlen"
                                value={num(rule('minLength'))}
                                onChange={(n) => setRule('behavior.validation.rules.minLength', n)}
                            />
                        </Row>
                        <Row id="insp-maxlen" label="At most">
                            <NumberInput
                                id="insp-maxlen"
                                value={num(rule('maxLength'))}
                                onChange={(n) => setRule('behavior.validation.rules.maxLength', n)}
                            />
                        </Row>
                    </div>
                </Section>
            )}
            {rules.includes('pattern') && (
                <Section title="Pattern">
                    <Row
                        id="insp-pattern"
                        label="Regular expression"
                        help="The whole value must match, e.g. ^[A-Z]{3}-\d{4}$"
                    >
                        <Input
                            id="insp-pattern"
                            value={String(rule('pattern') ?? '')}
                            className="font-mono text-xs"
                            onChange={(e) => setRule('behavior.validation.rules.pattern', e.target.value || undefined)}
                        />
                    </Row>
                    <Row id="insp-patmsg" label="Message when it does not match">
                        <Input
                            id="insp-patmsg"
                            value={String(rule('patternMessage') ?? '')}
                            placeholder="Invalid format"
                            onChange={(e) =>
                                setRule('behavior.validation.rules.patternMessage', e.target.value || undefined)
                            }
                        />
                    </Row>
                </Section>
            )}
            {rules.includes('range') && (
                <Section title="Range">
                    <div className="grid grid-cols-2 gap-3">
                        <Row id="insp-min" label="Smallest">
                            <NumberInput
                                id="insp-min"
                                value={num(rule('min'))}
                                onChange={(n) => setRule('behavior.validation.rules.min', n)}
                            />
                        </Row>
                        <Row id="insp-max" label="Largest">
                            <NumberInput
                                id="insp-max"
                                value={num(rule('max'))}
                                onChange={(n) => setRule('behavior.validation.rules.max', n)}
                            />
                        </Row>
                    </div>
                </Section>
            )}
            {rules.includes('dates') && (
                <Section title="Dates">
                    <Row label="Not before">
                        <DatePicker
                            value={parseDate(stored.props?.minDate)}
                            onChange={(d) => setRule('props.minDate', d ? day(d) : undefined)}
                            placeholder="Any day"
                            aria-label="Not before"
                        />
                    </Row>
                    <Row label="Not after">
                        <DatePicker
                            value={parseDate(stored.props?.maxDate)}
                            onChange={(d) => setRule('props.maxDate', d ? day(d) : undefined)}
                            placeholder="Any day"
                            aria-label="Not after"
                        />
                    </Row>
                </Section>
            )}
            {rules.includes('files') && (
                <Section title="Files">
                    <Row id="insp-accept" label="Allowed types" help="File endings or types, e.g. .pdf,image/*">
                        <Input
                            id="insp-accept"
                            value={String(stored.props?.accept ?? '')}
                            onChange={(e) => setRule('props.accept', e.target.value || undefined)}
                        />
                    </Row>
                    <Row id="insp-size" label="Largest file (MB)">
                        <NumberInput
                            id="insp-size"
                            value={
                                num(stored.props?.maxFileSize) !== undefined
                                    ? Math.round((num(stored.props?.maxFileSize)! / 1048576) * 100) / 100
                                    : undefined
                            }
                            onChange={(n) =>
                                setRule('props.maxFileSize', n === undefined ? undefined : Math.round(n * 1048576))
                            }
                        />
                    </Row>
                </Section>
            )}
            {rules.includes('items') && (
                <Section title="Rows">
                    <div className="grid grid-cols-2 gap-3">
                        <Row id="insp-minitems" label="At least">
                            <NumberInput
                                id="insp-minitems"
                                value={num(stored.props?.minItems)}
                                onChange={(n) => setRule('props.minItems', n)}
                            />
                        </Row>
                        <Row id="insp-maxitems" label="At most">
                            <NumberInput
                                id="insp-maxitems"
                                value={num(stored.props?.maxItems)}
                                onChange={(n) => setRule('props.maxItems', n)}
                            />
                        </Row>
                    </div>
                </Section>
            )}
            {!holdsValue(field) && !rules.length && (
                <p className="text-sm text-muted-foreground">Nothing to check: this field holds no value.</p>
            )}
        </div>
    );
}

function LogicTab({ stored, field }: { stored: FormField; field: EngineField }) {
    const { set } = useFieldEdit(stored.id);
    const byId = useDesigner((s) => s.doc.byId);
    const subjects = useMemo<ConditionSubject[]>(
        () =>
            Object.values(byId)
                .filter((f) => f.id !== stored.id)
                .map((f) => toEngineField(f as unknown as StoredField))
                .filter(holdsValue)
                .map((f) => ({
                    id: f.id,
                    label: f.label || f.id,
                    kind: NUMBERS.has(f.type)
                        ? 'number'
                        : BOOLEANS.has(f.type)
                          ? 'boolean'
                          : f.options.length
                            ? 'choice'
                            : 'text',
                    options: f.options
                })),
        [byId, stored.id]
    );
    const computed = stored.data?.computed as { expression: string; readOnly?: boolean } | undefined;
    const m = computed?.expression?.match(/\{\{\s*=([^{}]+)\}\}/);
    const formulaError = m ? checkFormula(m[1]) : null;
    return (
        <div className="flex flex-col gap-5">
            <Section title="Show only when">
                <ConditionsEditor
                    value={field.visibleWhen}
                    subjects={subjects}
                    onChange={(v) => set('behavior.visibilityConditions', v)}
                    emptyText="Always shown."
                />
            </Section>
            <Section title="Can be changed only when">
                <ConditionsEditor
                    value={field.enabledWhen}
                    subjects={subjects}
                    onChange={(v) => set('behavior.enabledConditions', v)}
                    emptyText="Always editable."
                />
            </Section>
            {holdsValue(field) && (
                <Section title="Calculated value">
                    <Row
                        id="insp-formula"
                        label="Formula or binding"
                        help="{{= row.qty * row.price }}, {{= round(sum(root.lines, 'total'), 2) }}, {{user.name}}. In a repeated row, row.* is that row and root.* the whole form."
                        error={formulaError ? `Formula error: ${formulaError}` : null}
                    >
                        <Textarea
                            id="insp-formula"
                            rows={2}
                            className="font-mono text-xs"
                            value={computed?.expression ?? ''}
                            onChange={(e) =>
                                set(
                                    'data.computed',
                                    e.target.value ? { ...computed, expression: e.target.value } : undefined
                                )
                            }
                        />
                    </Row>
                    {computed && (
                        <SwitchRow
                            id="insp-computed-ro"
                            label="Cannot be overwritten"
                            checked={computed.readOnly === true}
                            onChange={(v) => set('data.computed', { ...computed, readOnly: v })}
                        />
                    )}
                </Section>
            )}
        </div>
    );
}

function JsonTab({ stored }: { stored: FormField }) {
    const actions = useDesignerActions();
    const notify = useNotify();
    const original = useMemo(() => JSON.stringify(stored, null, 2), [stored]);
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const apply = () => {
        try {
            const parsed = storedFieldSchema.safeParse(JSON.parse(text ?? original));
            if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Not a field');
            const next = parsed.data as unknown as FormField;
            if (next.id !== stored.id) throw new Error('Change the key in the Field tab, not here');
            if (next.parentId !== stored.parentId) throw new Error('Move the field on the canvas, not here');
            actions.update(
                stored.id,
                (f) => {
                    for (const k of Object.keys(f)) if (!(k in next)) delete (f as Record<string, unknown>)[k];
                    Object.assign(f, next);
                },
                `${stored.id}:json`
            );
            setText(null);
            setError(null);
            notify.success('Field updated');
        } catch (e) {
            setError((e as Error).message);
        }
    };
    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
                Everything stored for this field. For settings the other tabs do not offer.
            </p>
            <Textarea
                aria-label="Field JSON"
                rows={18}
                spellCheck={false}
                className="font-mono text-xs"
                value={text ?? original}
                onChange={(e) => setText(e.target.value)}
            />
            {error && <FieldError>{error}</FieldError>}
            <div className="flex gap-2">
                <Button type="button" size="sm" disabled={text === null || text === original} onClick={apply}>
                    Apply
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={text === null}
                    onClick={() => (setText(null), setError(null))}
                >
                    Discard
                </Button>
            </div>
        </div>
    );
}

// ---- outline (nothing selected) ---------------------------------------------------------------------------------------------
function Outline() {
    const doc = useDesigner((s) => s.doc);
    const actions = useDesignerActions();
    const count = Object.keys(doc.byId).length;
    const item = (id: string, depth: number): ReactNode => {
        const f = doc.byId[id];
        const label = getFieldType(f.type)?.design?.label ?? f.type;
        return (
            <li key={id}>
                <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm py-1 pr-2 text-left text-sm hover:bg-accent"
                    style={{ paddingLeft: `${0.5 + depth}rem` }}
                    onClick={() => actions.select(id)}
                >
                    {(doc.children[id]?.length ?? 0) > 0 ? (
                        <ChevronRight className="size-3 text-muted-foreground" />
                    ) : (
                        <span className="w-3" />
                    )}
                    <span className="flex-1 truncate">{f.label || f.id}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                </button>
                {(doc.children[id]?.length ?? 0) > 0 && <ul>{doc.children[id].map((c) => item(c, depth + 1))}</ul>}
            </li>
        );
    };
    return (
        <div className="flex flex-col gap-3">
            <div>
                <h3 className="text-sm font-semibold">Form outline</h3>
                <p className="text-sm text-muted-foreground">
                    {count === 0
                        ? 'No fields yet.'
                        : `${count} field${count === 1 ? '' : 's'}. Select one to change it.`}
                </p>
            </div>
            <ul aria-label="Form outline">{(doc.children[ROOT] ?? []).map((id) => item(id, 0))}</ul>
            <p className="text-xs text-muted-foreground">
                Shortcuts: Ctrl+Z undo · Ctrl+Shift+Z redo · Del delete · Ctrl+D duplicate · Alt+↑/↓ move · Esc deselect
                · Ctrl+S save
            </p>
        </div>
    );
}

export function Inspector() {
    const selected = useDesigner((s) => s.selected);
    const selection = useDesigner((s) => s.selection);
    const stored = useDesigner((s) => (s.selected ? s.doc.byId[s.selected] : undefined));
    const field = useMemo(() => (stored ? toEngineField(stored as unknown as StoredField) : null), [stored]);
    const [tab, setTab] = useState('field');
    if (!selected || !stored || !field) return <Outline />;
    const design = getFieldType(field.type)?.design;
    const tabs: Array<{ id: string; label: string; body: ReactNode }> = [
        { id: 'field', label: 'Field', body: <FieldTab stored={stored} field={field} design={design} /> },
        ...(design?.settings
            ? [{ id: 'settings', label: 'Settings', body: <SettingsTab stored={stored} design={design} /> }]
            : []),
        ...(design?.options ? [{ id: 'options', label: 'Options', body: <OptionsTab stored={stored} /> }] : []),
        ...(field.type === 'DataTable'
            ? [{ id: 'rows', label: 'Rows', body: <RowsTab stored={stored} field={field} /> }]
            : []),
        ...(holdsValue(field) || design?.rules?.length
            ? [{ id: 'rules', label: 'Rules', body: <RulesTab stored={stored} field={field} design={design} /> }]
            : []),
        { id: 'logic', label: 'Logic', body: <LogicTab stored={stored} field={field} /> },
        { id: 'json', label: 'JSON', body: <JsonTab stored={stored} /> }
    ];
    const current = tabs.some((t) => t.id === tab) ? tab : 'field';
    const Icon = design?.icon;
    return (
        <div className="flex flex-col gap-3" data-inspector={stored.id}>
            <div className="flex items-center gap-2">
                {Icon && <Icon className="size-4 text-muted-foreground" />}
                <h3 className="flex-1 truncate text-sm font-semibold">{stored.label || stored.id}</h3>
                <Badge variant="outline" className={cn('font-mono')}>
                    {stored.id}
                </Badge>
            </div>
            <Tabs value={current} onValueChange={setTab}>
                <TabsList className="h-auto w-full flex-wrap justify-start">
                    {tabs.map((t) => (
                        <TabsTrigger key={t.id} value={t.id} className="flex-none">
                            {t.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                {tabs.map((t) => (
                    <TabsContent key={t.id} value={t.id} className="pt-3">
                        {/* a fresh tab per field: local drafts (key, JSON) never leak to the next selection */}
                        <div key={selection}>{t.body}</div>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
