'use client';

/**
 * The fields of a form, laid out and wired to TanStack Form. Each field subscribes only to what it reads: its own value and
 * errors, the values its visibility/enablement rules look at, and (for a computed field) the values of its scope. Typing in
 * one field re-renders that field, not the form.
 *
 * Values sit at `fieldId` or, inside a repeatable section, at `sectionId[row].fieldId`. Containers (panels, cards) are
 * transparent for values: their children's values sit beside theirs.
 */
import { createContext, memo, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import isEqual from 'lodash/isEqual.js';
import { CircleCheck, Plus, Trash2 } from 'lucide-react';
import { useField, useSelector, type AnyFormApi } from '@tanstack/react-form';
import { Button, FieldDescription, FieldError, Field as FieldShell, FieldLabel, Spinner, cn } from '@itrms/ui';
import {
    REMOTE_PENDING,
    childrenOf,
    emptyRow,
    isEnabledIn,
    isVisibleIn,
    type EngineDocument,
    type EngineField
} from '../core';
import { getByPath, resolveString } from '../Runtime/expression';
import { runAction } from './actions';
import { spanWidth, validSpan } from './span';
import { getFieldType, type ValueFieldDef } from './kit';
import { useDataSource, useRuntimeApi, useRuntimeScope, useRuntimeStore } from './runtimeScope';

type Values = Record<string, unknown>;

interface TreeContext {
    form: AnyFormApi;
    doc: EngineDocument;
    byId: Map<string, EngineField>;
    readOnly: boolean;
}
const TreeCtx = createContext<TreeContext | null>(null);
export const TreeProvider = TreeCtx.Provider;
const useTree = () => useContext(TreeCtx)!;

/** Where a field's values live: the form (`rowPath` '') or one row of a section (`items[2]`), and the section that row belongs to. */
interface Scope {
    rowPath: string;
    sectionId: string | null;
    domPrefix: string;
}
const ROOT: Scope = { rowPath: '', sectionId: null, domPrefix: 'fe-' };
const valuesAt = (values: Values, rowPath: string): Values =>
    ((rowPath ? getByPath(values, rowPath) : values) ?? {}) as Values;
const pathOf = (scope: Scope, id: string) => (scope.rowPath ? `${scope.rowPath}.${id}` : id);

/** Width of a field: its Width property (1-12 of 12 columns), else what an older template's class names asked for. */
export function widthOf(
    field: EngineField,
    inRow: boolean
): { style?: CSSProperties; span?: number; className?: string } {
    const span = validSpan(field.props.span);
    if (span) return { span, style: { width: spanWidth(span) } };
    // Semgrep reports from the line that reads the input, so the suppression sits here: the two patterns below are fixed
    // and have no nested quantifiers (linear time).
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
    const cls = String(field.props.className ?? '');
    const col = /(?:^|\s)col-(\d{1,2})(?:\s|$)/.exec(cls);
    const frac = /(?:^|\s)w-(\d)\/(\d)(?:\s|$)/.exec(cls);
    const legacy = col
        ? validSpan(Number(col[1]))
        : frac
          ? validSpan(Math.round((Number(frac[1]) / Number(frac[2])) * 12))
          : undefined;
    if (/(?:^|\s)flex-1(?:\s|$)/.test(cls)) return { style: { flex: '1 1 14rem', minWidth: 0 } };
    if (legacy) return { span: legacy, style: { width: spanWidth(legacy) } };
    // fields of a repeated row sit side by side by default (as they always did); elsewhere full width
    return inRow && !field.isContainer ? { className: 'fe-row-cell' } : { style: { width: '100%' } };
}

/** The children of `parentId`, in a wrapping row (a field's Width puts fields side by side). */
export function FieldList({ parentId, scope = ROOT }: { parentId: string | null; scope?: Scope }) {
    const { doc } = useTree();
    const children = useMemo(() => childrenOf(doc.fields, parentId), [doc.fields, parentId]);
    if (!children.length) return null;
    return (
        <div className="fe-flow">
            {children.map((f) => (
                <FieldNode key={f.id} field={f} scope={scope} />
            ))}
        </div>
    );
}

/** Visibility + enablement of one field, from the values of its scope (re-renders only when the answer changes). */
function useRules(field: EngineField, scope: Scope): { visible: boolean; enabled: boolean } {
    const { form, byId, readOnly } = useTree();
    const runtime = useRuntimeScope();
    const code = useSelector(form.store, (s: { values: Values }) => {
        const values = valuesAt(s.values, scope.rowPath);
        const ctx = { ...runtime, root: s.values };
        const visible = isVisibleIn(field, byId, values, ctx, scope.sectionId);
        const enabled = visible && isEnabledIn(field, byId, values, ctx, scope.sectionId);
        return (visible ? 2 : 0) + (enabled ? 1 : 0);
    });
    return { visible: code >= 2, enabled: !readOnly && code % 2 === 1 };
}

const FieldNode = memo(function FieldNode({ field, scope }: { field: EngineField; scope: Scope }) {
    const { visible, enabled } = useRules(field, scope);
    const def = getFieldType(field.type);
    if (!visible || !def) return null;
    const width = widthOf(field, scope.sectionId !== null);
    const disabled = !enabled || field.props.disabled === true;
    let body: ReactNode;
    switch (def.kind) {
        case 'value':
            body = (
                <ValueField
                    field={field}
                    scope={scope}
                    disabled={disabled || Boolean(field.computed?.readOnly)}
                    inlineLabel={def.label === 'inline'}
                    Render={def.Render}
                />
            );
            break;
        case 'container':
            body = (
                <def.Render field={field} disabled={disabled}>
                    <FieldList parentId={field.id} scope={scope} />
                </def.Render>
            );
            break;
        case 'section':
            body = <Section field={field} scope={scope} disabled={disabled} />;
            break;
        case 'display':
            body = <def.Render field={field} />;
            break;
    }
    return (
        <div
            className={cn('field-renderer', width.className)}
            style={width.style}
            data-span={width.span}
            data-field-id={field.id}
            data-field-type={field.type}
        >
            {body}
        </div>
    );
});

/** Messages are shown once the person has left the field, or after a submit attempt. */
function useShownError(meta: { isTouched: boolean; errors: unknown[] }): string | undefined {
    const { form, readOnly } = useTree();
    const attempted = useSelector(form.store, (s: { submissionAttempts: number }) => s.submissionAttempts > 0);
    if (readOnly || !(meta.isTouched || attempted)) return undefined;
    const first = meta.errors.find((e) => typeof e === 'string' || (e && typeof e === 'object' && 'message' in e));
    return typeof first === 'string' ? first : (first as { message?: string } | undefined)?.message;
}

function ValueField({
    field,
    scope,
    disabled,
    inlineLabel,
    Render
}: {
    field: EngineField;
    scope: Scope;
    disabled: boolean;
    inlineLabel: boolean;
    Render: ValueFieldDef['Render'];
}) {
    const { form, readOnly } = useTree();
    const name = pathOf(scope, field.id);
    const api = useField({ form, name });
    const shown = useShownError(api.state.meta);
    // a remote check (`behavior.validation.remote`) in progress is shown as progress, not as a mistake
    const checking = shown === REMOTE_PENDING;
    const error = checking ? undefined : shown;
    const remote = useDataSource(field.remote?.dataSourceId);
    const verified =
        !!field.remote && remote?.status === 'success' && !shown && api.state.value !== '' && api.state.value != null;
    const domId = `${scope.domPrefix}${field.id}`;
    const helpId = `${domId}-help`;
    const runtimeApi = useRuntimeApi();
    const store = useRuntimeStore();

    useComputed(field, scope, readOnly);

    const runActions = (event: string, eventData?: unknown) => {
        const list = field.actions[event];
        if (!list?.length) return;
        for (const action of list) {
            void runAction(action, {
                formValues: valuesAt(form.state.values, scope.rowPath),
                context: { ...store.get().scope, root: form.state.values, eventData, fieldId: field.id },
                runApi: runtimeApi.run,
                setFieldValue: (k, v) => form.setFieldValue(scope.rowPath ? `${scope.rowPath}.${k}` : k, v),
                refetch: runtimeApi.refetch
            }).catch(() => undefined);
        }
    };

    const describedBy = error || field.helpText ? helpId : undefined;
    return (
        <FieldShell
            data-invalid={error ? true : undefined}
            data-disabled={disabled || undefined}
            onFocus={() => runActions('onFocus')}
        >
            {!inlineLabel && field.label && (
                <FieldLabel htmlFor={domId}>
                    {field.label}
                    {field.rules.required && <span className="text-destructive">*</span>}
                </FieldLabel>
            )}
            <Render
                field={field}
                id={domId}
                value={api.state.value}
                disabled={disabled}
                invalid={!!error}
                describedBy={describedBy}
                onChange={(v: unknown) => {
                    // a message the server gave for this field (on the last submit) is about the old value
                    if (api.state.meta.errorMap.onServer)
                        api.setMeta((m) => ({ ...m, errorMap: { ...m.errorMap, onServer: undefined } }));
                    api.handleChange(v as never);
                    runActions('onChange', v);
                }}
                onBlur={() => {
                    api.handleBlur();
                    runActions('onBlur');
                }}
            />
            {checking && (
                <FieldDescription className="flex items-center gap-1.5" data-remote="checking">
                    <Spinner className="size-3.5" /> {REMOTE_PENDING}
                </FieldDescription>
            )}
            {verified && (
                <FieldDescription
                    className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"
                    data-remote="verified"
                >
                    <CircleCheck className="size-3.5" aria-hidden="true" /> Verified
                </FieldDescription>
            )}
            {field.helpText && <FieldDescription id={error ? undefined : helpId}>{field.helpText}</FieldDescription>}
            {error && <FieldError id={helpId}>{field.messages[error] || error}</FieldError>}
        </FieldShell>
    );
}

/** A computed field (`{{= formula }}` / bindings over the form, the row and the runtime) keeps its value up to date. */
function useComputed(field: EngineField, scope: Scope, readOnly: boolean) {
    const { form } = useTree();
    const runtime = useRuntimeScope();
    const expression = field.computed?.expression;
    const value = useSelector(
        form.store,
        (s: { values: Values }) => {
            if (!expression) return undefined;
            const values = valuesAt(s.values, scope.rowPath);
            return resolveString(expression, { form: values, row: values, ...runtime, root: s.values });
        },
        { compare: isEqual }
    );
    useEffect(() => {
        if (readOnly || !expression || value === undefined) return;
        const name = pathOf(scope, field.id);
        if (!isEqual(getByPath(form.state.values, name), value))
            form.setFieldValue(name, value as never, { dontUpdateMeta: true });
    }, [value, readOnly, expression, form, scope, field.id]);
}

/** Repeatable section: one row per entry, each row the section's child fields with its own values, rules and errors. */
function Section({ field, scope, disabled }: { field: EngineField; scope: Scope; disabled: boolean }) {
    const { form, doc, readOnly } = useTree();
    const name = pathOf(scope, field.id);
    const api = useField({ form, name, mode: 'array' });
    const error = useShownError(api.state.meta);
    const rows = Array.isArray(api.state.value) ? (api.state.value as unknown[]) : [];
    const { minItems: min, maxItems: max } = field.rules;
    const noun = String(field.props.itemLabel || 'Item');
    const locked = readOnly || disabled;

    return (
        <div
            className="flex flex-col gap-3"
            role="group"
            aria-label={field.label || 'Repeatable section'}
            data-formarray={field.id}
        >
            {field.label && <div className="text-sm font-medium">{field.label}</div>}
            {rows.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {String(field.props.emptyMessage || `No ${noun.toLowerCase()}s yet`)}
                </div>
            )}
            {rows.map((_, index) => (
                <div
                    key={index}
                    className="rounded-lg border bg-card p-4"
                    role="group"
                    aria-label={`${noun} ${index + 1}`}
                    data-row={index}
                >
                    <div className="mb-3 flex items-center justify-between">
                        <h5 className="text-sm font-semibold">{`${noun} ${index + 1}`}</h5>
                        {!locked && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
                                disabled={rows.length <= min}
                                title={
                                    rows.length <= min
                                        ? `At least ${min} required`
                                        : String(field.props.removeButtonLabel || 'Remove')
                                }
                                aria-label={`Remove ${noun} ${index + 1}`}
                                onClick={() => api.removeValue(index)}
                            >
                                <Trash2 />
                            </Button>
                        )}
                    </div>
                    <FieldList
                        parentId={field.id}
                        scope={{
                            rowPath: `${name}[${index}]`,
                            sectionId: field.id,
                            domPrefix: `${scope.domPrefix}${field.id}-${index}-`
                        }}
                    />
                </div>
            ))}
            {!locked && (
                <div className="flex items-center gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={rows.length >= max}
                        onClick={() => api.pushValue(emptyRow(field, doc.fields) as never)}
                    >
                        <Plus />
                        {String(field.props.addButtonLabel || 'Add row')}
                    </Button>
                    {Number.isFinite(max) && (
                        <span className="text-sm text-muted-foreground">
                            {rows.length} of {max}
                        </span>
                    )}
                </div>
            )}
            {error && <FieldError>{error}</FieldError>}
        </div>
    );
}
