'use client';

/**
 * A saved template as a working form, on the design system and TanStack Form (validation: the engine core's Zod rules).
 * `FormRenderer` (the public component) wraps it and names any field the kit cannot draw.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, RefreshCw, RotateCcw, Check } from 'lucide-react';
import { useForm, useSelector, type AnyFormApi } from '@tanstack/react-form';
import { Button, Card, Spinner, cn, useNotify } from '@platform/ui';
import logger from '@platform/lib/logger';
import { isReported } from '@platform/lib/api/errors';
import { serverFormErrors } from '@platform/lib/forms/serverErrors';
import { useAuthUser } from '@platform/lib/auth/authHooks';
import type { IFormTemplate } from '@/types/template_builder/form';
import type { FormField } from '../core/storedTypes';
import { initialValues, pruneHidden, readDocument, validateForm, type EngineDocument, type FieldErrors } from '../core';
import { RuntimeProvider } from '../Runtime/RuntimeProvider';
import { mapToForm } from '../Runtime/mapping';
import { resolveBindings, resolveString } from '../Runtime/expression';
import type { TemplateRuntimeConfig } from '../Runtime/types';
import { useTemplate } from '../store/formStore';
import { unsupportedFields } from './kit';
import { RuntimeBridge, RuntimeStore, RuntimeStoreProvider, useRuntimeApi, useRuntimeSelector } from './runtimeScope';
import { FieldList, TreeProvider } from './FieldTree';
import './fields/registerAll';

type Values = Record<string, unknown>;

export interface EngineFormProps {
    fields: FormField[];
    template?: IFormTemplate;
    /** Saves the request; what it resolves with (the saved request) is `{{response.*}}` in the submit success message. */
    onFormSubmit?: (values: any) => void | Promise<unknown>;
    submissionId?: string | null;
    initialValues?: Record<string, any>;
    onSuccess?: (submission: any) => void;
    /** Overrides `template.form_config.runtime`. */
    runtime?: TemplateRuntimeConfig;
    /** Authenticated user context for `{{user.*}}` bindings, supplied by the host app. */
    user?: Record<string, any>;
    /** Display-only template (a table, a summary…): no card, no buttons. */
    view?: boolean;
    /** No card around the form (the host, e.g. a dialog, already is the container). */
    bare?: boolean;
    submitLabel?: string;
    /** Show a saved record: the real form with its values, nothing editable and no buttons. */
    readOnly?: boolean;
    showRefresh?: boolean;
    /** No "submitted" message (the builder's preview shows what would be stored instead). */
    silent?: boolean;
}

/** True when the field kit can draw every field of `doc`. */
export function canRenderWithEngine(doc: EngineDocument): boolean {
    return doc.invalid.length === 0 && unsupportedFields(doc.fields).length === 0;
}

const toFormErrors = (errors: FieldErrors) => (Object.keys(errors).length ? { fields: errors } : undefined);

export function EngineForm(props: EngineFormProps) {
    const doc = useMemo(() => readDocument({ fields: props.fields }), [props.fields]);
    // a new request leaves an empty form behind; an edited request is shown again when its saved values change
    const [resetKey, setResetKey] = useState(0);
    const valuesKey = props.submissionId ? JSON.stringify(props.initialValues ?? {}) : '';
    return <EngineFormBody key={`${resetKey}:${valuesKey}`} {...props} doc={doc} remount={() => setResetKey((k) => k + 1)} />;
}

function EngineFormBody({ doc, template, onFormSubmit, submissionId, initialValues: saved, onSuccess, runtime, user, view, bare, submitLabel, readOnly, showRefresh, silent, remount }: EngineFormProps & { doc: EngineDocument; remount: () => void }) {
    const notify = useNotify();
    const authUser = useAuthUser();
    const builderTemplate = useTemplate();
    const [store] = useState(() => new RuntimeStore());
    const runtimeConfig = runtime ?? readDocument(template?.form_config).runtime ?? readDocument(builderTemplate?.form_config).runtime;
    const defaults = useMemo(() => initialValues(doc.fields, saved), [doc.fields, saved]);
    const runtimeUser = useMemo(() => user ?? (authUser ? { id: authUser.id, email: authUser.email, name: authUser.full_name, roles: authUser.roles, tenant_id: authUser.tenant_id } : undefined), [user, authUser]);

    const submit = async (values: Values, form: AnyFormApi) => {
        try {
            if (!template?.id) throw new Error('Template ID is required');
            const scope = store.get().scope;
            const pruned = pruneHidden(doc.fields, values, scope);
            const submission = { template_id: template.id, submission_data: pruned, status: 'submitted', form_metadata: { submitted_via: 'web', user_agent: navigator.userAgent, submission_type: submissionId ? 'update' : 'new' } };

            // optional API call configured on the template (auth via the shared client)
            const submitCfg = runtimeConfig?.submit;
            let response: unknown;
            if (submitCfg?.dataSourceId) {
                const body = submitCfg.body !== undefined ? resolveBindings(submitCfg.body, { ...scope, form: pruned }) : pruned;
                const result = await store.api.run(submitCfg.dataSourceId, body);
                response = result;
                const ds = runtimeConfig?.dataSources.find((d) => d.id === submitCfg.dataSourceId);
                Object.entries(mapToForm(result, ds?.responseMapping?.toForm)).forEach(([k, v]) => form.setFieldValue(k, v as never, { dontValidate: true }));
                await Promise.all((submitCfg.refetch ?? []).map((id) => store.api.refetch(id)));
            }
            if (onFormSubmit && !submitCfg?.skipDefaultSubmission) response = (await onFormSubmit(submission)) ?? response;

            // the message may show what the server did, e.g. "Posted {{response.submission_data.reference}}"
            const message = submitCfg?.successMessage ? String(resolveString(submitCfg.successMessage, { ...scope, form: pruned, response: response ?? {} }) ?? '') : '';
            if (!silent) notify.success(message.trim() || (submissionId ? 'Changes saved' : 'Submitted successfully'));
            onSuccess?.(undefined);
            if (!submissionId && submitCfg?.resetOnSuccess !== false) remount();
            else if (submitCfg?.resetOnSuccess) form.reset();
        } catch (err: any) {
            logger.error('Form submission failed:', err);
            // the server's verdict on single fields (422 `errors[{field, message}]`) is shown on those fields
            const server = serverFormErrors(err, doc.fields.map((f) => f.id));
            Object.entries(server.fields).forEach(([name, message]) => form.setFieldMeta(name, (m) => ({ ...m, isTouched: true, errorMap: { ...m.errorMap, onServer: message } })));
            // mutations already toasted their failure (QueryProvider); only report what nobody has told the person about
            if (!isReported(err)) notify.error(err?.response?.data?.detail || err?.response?.data?.message || err?.message || 'Failed to submit form. Please try again.');
        }
    };

    const form = useForm({
        defaultValues: defaults,
        canSubmitWhenInvalid: true,
        validators: {
            onChange: ({ value }) => toFormErrors(validateForm(doc.fields, value as Values, store.get().scope)),
            onSubmit: ({ value }) => toFormErrors(validateForm(doc.fields, value as Values, store.get().scope))
        },
        onSubmit: ({ value, formApi }) => submit(value as Values, formApi as AnyFormApi)
    });
    // a remote check finished (or started): validate again, so its verdict shows on the field and decides whether one may submit
    const hasRemote = useMemo(() => doc.fields.some((f) => f.remote), [doc.fields]);
    useEffect(() => {
        if (!hasRemote) return;
        let last = '';
        return store.subscribe(() => {
            const now = JSON.stringify(store.get().scope.status ?? {});
            if (now === last) return;
            last = now;
            void form.validate('change');
        });
    }, [hasRemote, store, form]);
    const byId = useMemo(() => new Map(doc.fields.map((f) => [f.id, f])), [doc.fields]);
    const tree = useMemo(() => ({ form: form as unknown as AnyFormApi, doc, byId, readOnly: !!readOnly }), [form, doc, byId, readOnly]);
    const plain = view || readOnly || bare;

    const body = (
        <form
            noValidate
            className={cn('flex flex-col gap-4', readOnly && '[&_:disabled]:opacity-100 [&_[data-disabled]]:opacity-100')}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
            }}
        >
            <FieldList parentId={null} />
            {!view && !readOnly && <FormFooter form={form as unknown as AnyFormApi} submitLabel={submitLabel ?? (submissionId ? 'Save changes' : 'Submit')} showRefresh={showRefresh} />}
        </form>
    );

    return (
        <RuntimeStoreProvider value={store}>
            <TreeProvider value={tree}>
                <RuntimeHost form={form as unknown as AnyFormApi} config={runtimeConfig} user={runtimeUser} store={store}>
                    <div data-engine="v2">
                        {plain ? body : <Card className="p-6">{body}</Card>}
                    </div>
                </RuntimeHost>
            </TreeProvider>
        </RuntimeStoreProvider>
    );
}

/** The runtime sees the live form values (`{{form.*}}` in data source requests); only it re-renders on each change. */
function RuntimeHost({ form, config, user, store, children }: { form: AnyFormApi; config?: TemplateRuntimeConfig; user?: Record<string, any>; store: RuntimeStore; children: ReactNode }) {
    const values = useSelector(form.store, (s: { values: Values }) => s.values);
    return (
        <RuntimeProvider config={config} formValues={values} user={user} onPatchForm={(patch) => Object.entries(patch).forEach(([k, v]) => form.setFieldValue(k, v as never, { dontValidate: true }))}>
            <RuntimeBridge store={store} />
            {children}
        </RuntimeProvider>
    );
}

function FormFooter({ form, submitLabel, showRefresh }: { form: AnyFormApi; submitLabel: string; showRefresh?: boolean }) {
    const api = useRuntimeApi();
    const hasSources = useRuntimeSelector((s) => Object.keys(s.states).length > 0);
    const busy = useRuntimeSelector((s) => Object.values(s.states).some((x) => x.isFetching));
    const submitting = useSelector(form.store, (s: { isSubmitting: boolean }) => s.isSubmitting);
    const dirty = useSelector(form.store, (s: { isDirty: boolean }) => s.isDirty);
    return (
        <div className="flex flex-col gap-3">
            <ErrorSummary form={form} />
            <div className="flex flex-wrap justify-end gap-2">
                {showRefresh && hasSources && (
                    <Button type="button" variant="ghost" disabled={submitting || busy} onClick={() => void api.refetch()}>
                        {busy ? <Spinner /> : <RefreshCw />}
                        Refresh data
                    </Button>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    disabled={submitting || !dirty}
                    onClick={() => {
                        form.reset();
                        void api.reload();
                    }}
                >
                    <RotateCcw />
                    Clear form
                </Button>
                <Button type="submit" disabled={submitting}>
                    {submitting ? <Spinner /> : <Check />}
                    {submitLabel}
                </Button>
            </div>
        </div>
    );
}

/**
 * After a submit stopped by validation: how many fields need attention, and the first one scrolled into view and focused
 * (a long form otherwise looks as if nothing happened).
 */
function ErrorSummary({ form }: { form: AnyFormApi }) {
    const attempts = useSelector(form.store, (s: { submissionAttempts: number }) => s.submissionAttempts);
    const count = useSelector(form.store, (s: { isSubmitting: boolean; fieldMeta: Record<string, { errors?: unknown[] } | undefined> }) => (s.isSubmitting ? 0 : Object.values(s.fieldMeta).filter((m) => (m?.errors?.length ?? 0) > 0).length));
    const handled = useRef(0);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (attempts === 0 || count === 0 || handled.current === attempts) return;
        handled.current = attempts;
        const first = ref.current?.closest('form')?.querySelector<HTMLElement>('[data-field-id] [aria-invalid="true"]');
        first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        first?.focus({ preventScroll: true });
    }, [attempts, count]);
    if (attempts === 0 || count === 0) return <div ref={ref} />;
    return (
        <div ref={ref} role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
            {count === 1 ? 'Please fix 1 field before submitting.' : `Please fix ${count} fields before submitting.`}
        </div>
    );
}
