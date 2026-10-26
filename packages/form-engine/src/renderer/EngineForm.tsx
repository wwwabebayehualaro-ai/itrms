'use client';

/**
 * A saved template as a working form, on the design system and TanStack Form (validation: the engine core's Zod rules).
 * `FormRenderer` (the public component) wraps it and names any field the kit cannot draw.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, RefreshCw, RotateCcw, Check } from 'lucide-react';
import { useForm, useSelector, type AnyFormApi } from '@tanstack/react-form';
import { Button, Card, Spinner, cn, useNotify } from '@itrms/ui';
import { serverFormErrors } from '../host/client';
import { useFormsHost, useFormsLanguages, useFormsUser } from '../host/FormsHost';
import { EngineTextLanguage, useEngineText } from '../host/text';
import type { FormField, FormTemplate } from '@itrms/schemas';
import { initialValues, pruneHidden, readDocument, validateForm, type EngineDocument, type FieldErrors } from '../core';
import { RuntimeProvider } from './runtime/RuntimeProvider';
import { mapToForm } from '../core/runtime/mapping';
import { resolveBindings, resolveString } from '../core/runtime/expression';
import { text } from '../core/runtime/path';
import type { TemplateRuntimeConfig } from '@itrms/schemas';
import { useTemplate } from './store/formStore';
import { unsupportedFields } from './kit';
import { RuntimeBridge, RuntimeStore, RuntimeStoreProvider, useRuntimeApi, useRuntimeSelector } from './runtimeScope';
import { FieldList, TreeProvider } from './FieldTree';
import './fields/registerAll';

type Values = Record<string, unknown>;

/** What a submit hands to `onFormSubmit`: the answers (hidden fields pruned) and how they were given. */
export interface EngineSubmission {
    template_id: string;
    form_version_id?: string;
    submission_data: Values;
    status: 'submitted';
    form_metadata: { submitted_via: 'web'; user_agent: string; submission_type: 'update' | 'new' };
}

export interface EngineFormProps {
    fields: FormField[];
    template?: FormTemplate;
    /** Saves the request; what it resolves with (the saved request) is `{{response.*}}` in the submit success message. */
    onFormSubmit?: (submission: EngineSubmission) => void | Promise<unknown>;
    submissionId?: string | null;
    initialValues?: Values;
    onSuccess?: (submission: unknown) => void;
    /** Overrides `template.form_config.runtime`. */
    runtime?: TemplateRuntimeConfig;
    /** Authenticated user context for `{{user.*}}` bindings, supplied by the host app. */
    user?: Values;
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
    /** The language its texts are shown in (default: the screens' language). */
    language?: string;
}

/** True when the field kit can draw every field of `doc`. */
export function canRenderWithEngine(doc: EngineDocument): boolean {
    return doc.invalid.length === 0 && unsupportedFields(doc.fields).length === 0;
}

const toFormErrors = (errors: FieldErrors) => (Object.keys(errors).length ? { fields: errors } : undefined);

export function EngineForm(props: EngineFormProps) {
    const { language: shown } = useFormsLanguages();
    const language = props.language ?? shown;
    const doc = useMemo(() => readDocument({ fields: props.fields }, { language }), [props.fields, language]);
    // a new request leaves an empty form behind; an edited request is shown again when its saved values change
    const [resetKey, setResetKey] = useState(0);
    const valuesKey = props.submissionId ? JSON.stringify(props.initialValues ?? {}) : '';
    return (
        // the engine's own words (buttons, messages) follow the language the form is drawn in
        <EngineTextLanguage language={language}>
            <EngineFormBody
                key={`${resetKey}:${valuesKey}`}
                {...props}
                doc={doc}
                remount={() => setResetKey((k) => k + 1)}
            />
        </EngineTextLanguage>
    );
}

function EngineFormBody({
    doc,
    template,
    onFormSubmit,
    submissionId,
    initialValues: saved,
    onSuccess,
    runtime,
    user,
    view,
    bare,
    submitLabel,
    readOnly,
    showRefresh,
    silent,
    remount
}: EngineFormProps & { doc: EngineDocument; remount: () => void }) {
    const notify = useNotify();
    const words = useEngineText();
    const host = useFormsHost();
    const authUser = useFormsUser();
    const builderTemplate = useTemplate();
    const [store] = useState(() => new RuntimeStore());
    const runtimeConfig =
        runtime ?? readDocument(template?.form_config).runtime ?? readDocument(builderTemplate?.form_config).runtime;
    const defaults = useMemo(() => initialValues(doc.fields, saved), [doc.fields, saved]);
    const runtimeUser = useMemo(
        () =>
            user ??
            (authUser
                ? {
                      id: authUser.id,
                      email: authUser.email,
                      name: authUser.full_name,
                      roles: authUser.roles,
                      tenant_id: authUser.tenant_id
                  }
                : undefined),
        [user, authUser]
    );

    const submit = async (values: Values, form: AnyFormApi) => {
        try {
            if (!template?.id) throw new Error('Template ID is required');
            const scope = store.get().scope;
            const pruned = pruneHidden(doc.fields, values, scope);
            const submission: EngineSubmission = {
                template_id: template.id,
                ...(template.published_version_id ? { form_version_id: template.published_version_id } : {}),
                submission_data: pruned,
                status: 'submitted',
                form_metadata: {
                    submitted_via: 'web',
                    user_agent: navigator.userAgent,
                    submission_type: submissionId ? 'update' : 'new'
                }
            };

            // optional API call configured on the template (auth via the shared client)
            const submitCfg = runtimeConfig?.submit;
            let response: unknown;
            if (submitCfg?.dataSourceId) {
                const body =
                    submitCfg.body !== undefined ? resolveBindings(submitCfg.body, { ...scope, form: pruned }) : pruned;
                const result = await store.api.run(submitCfg.dataSourceId, body);
                response = result;
                const ds = runtimeConfig?.dataSources.find((d) => d.id === submitCfg.dataSourceId);
                Object.entries(mapToForm(result, ds?.responseMapping?.toForm)).forEach(([k, v]) =>
                    form.setFieldValue(k, v, { dontValidate: true })
                );
                await Promise.all((submitCfg.refetch ?? []).map((id) => store.api.refetch(id)));
            }
            if (onFormSubmit && !submitCfg?.skipDefaultSubmission)
                response = (await onFormSubmit(submission)) ?? response;

            // the message may show what the server did, e.g. "Posted {{response.submission_data.reference}}"
            const message = submitCfg?.successMessage
                ? text(resolveString(submitCfg.successMessage, { ...scope, form: pruned, response: response ?? {} }))
                : '';
            if (!silent)
                notify.success(
                    message.trim() ||
                        words.t(submissionId ? 'form-engine.renderer.submit.saved' : 'form-engine.renderer.submit.done')
                );
            onSuccess?.(undefined);
            if (!submissionId && submitCfg?.resetOnSuccess !== false) remount();
            else if (submitCfg?.resetOnSuccess) form.reset();
        } catch (err) {
            host.logError?.('Form submission failed:', err);
            // whatever was thrown (an API error, an Error): read the message it may carry
            const failure = err as
                { response?: { data?: { detail?: unknown; message?: unknown } }; message?: unknown } | null | undefined;
            // the server's verdict on single fields (422 `errors[{field, message}]`) is shown on those fields
            const server = serverFormErrors(
                err,
                doc.fields.map((f) => f.id)
            );
            Object.entries(server.fields).forEach(([name, message]) =>
                form.setFieldMeta(name, (m) => ({
                    ...m,
                    isTouched: true,
                    errorMap: { ...m.errorMap, onServer: message }
                }))
            );
            // mutations already toasted their failure (QueryProvider); only report what nobody has told the person about
            if (!host.isReported?.(err))
                notify.error(
                    [failure?.response?.data?.detail, failure?.response?.data?.message, failure?.message].find(
                        (m): m is string => typeof m === 'string' && m !== ''
                    ) ?? words.t('form-engine.renderer.submit.failed')
                );
        }
    };

    const form = useForm({
        defaultValues: defaults,
        canSubmitWhenInvalid: true,
        validators: {
            onChange: ({ value }) =>
                toFormErrors(
                    validateForm(doc.fields, value as Values, store.get().scope, { language: words.language })
                ),
            onSubmit: ({ value }) =>
                toFormErrors(validateForm(doc.fields, value as Values, store.get().scope, { language: words.language }))
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
    const tree = useMemo(() => ({ form: form, doc, byId, readOnly: !!readOnly }), [form, doc, byId, readOnly]);
    const plain = view || readOnly || bare;

    const body = (
        <form
            noValidate
            className={cn(
                'flex flex-col gap-4',
                readOnly && '[&_:disabled]:opacity-100 [&_[data-disabled]]:opacity-100'
            )}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
            }}
        >
            <FieldList parentId={null} />
            {!view && !readOnly && (
                <FormFooter
                    form={form}
                    submitLabel={
                        submitLabel ??
                        words.t(
                            submissionId
                                ? 'form-engine.renderer.submit.saveChanges'
                                : 'form-engine.renderer.submit.label'
                        )
                    }
                    showRefresh={showRefresh}
                />
            )}
        </form>
    );

    return (
        <RuntimeStoreProvider value={store}>
            <TreeProvider value={tree}>
                <RuntimeHost form={form} config={runtimeConfig} user={runtimeUser} store={store}>
                    <div data-engine="v2">{plain ? body : <Card className="p-6">{body}</Card>}</div>
                </RuntimeHost>
            </TreeProvider>
        </RuntimeStoreProvider>
    );
}

/** The runtime sees the live form values (`{{form.*}}` in data source requests); only it re-renders on each change. */
function RuntimeHost({
    form,
    config,
    user,
    store,
    children
}: {
    form: AnyFormApi;
    config?: TemplateRuntimeConfig;
    user?: Values;
    store: RuntimeStore;
    children: ReactNode;
}) {
    const values = useSelector(form.store, (s: { values: Values }) => s.values);
    return (
        <RuntimeProvider
            config={config}
            formValues={values}
            user={user}
            onPatchForm={(patch) =>
                Object.entries(patch).forEach(([k, v]) => form.setFieldValue(k, v, { dontValidate: true }))
            }
        >
            <RuntimeBridge store={store} />
            {children}
        </RuntimeProvider>
    );
}

function FormFooter({
    form,
    submitLabel,
    showRefresh
}: {
    form: AnyFormApi;
    submitLabel: string;
    showRefresh?: boolean;
}) {
    const { t } = useEngineText();
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
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={submitting || busy}
                        onClick={() => void api.refetch()}
                    >
                        {busy ? <Spinner /> : <RefreshCw />}
                        {t('form-engine.renderer.submit.refresh')}
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
                    {t('form-engine.renderer.submit.clear')}
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
    const { t } = useEngineText();
    const attempts = useSelector(form.store, (s: { submissionAttempts: number }) => s.submissionAttempts);
    const count = useSelector(
        form.store,
        (s: { isSubmitting: boolean; fieldMeta: Record<string, { errors?: unknown[] } | undefined> }) =>
            s.isSubmitting ? 0 : Object.values(s.fieldMeta).filter((m) => (m?.errors?.length ?? 0) > 0).length
    );
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
        <div
            ref={ref}
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
            <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
            {t('form-engine.renderer.submit.fixFields', { count })}
        </div>
    );
}
