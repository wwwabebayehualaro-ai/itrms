'use client';

/**
 * Hand-written forms (coded features, platform screens): TanStack Form + Zod, rendered with the design-system primitives.
 *
 *   const schema = z.object({ name: z.string().min(1, 'Required'), active: z.boolean() });
 *   const form = useZodForm({ schema, defaultValues: { name: '', active: true }, onSubmit: (v) => save.mutateAsync(v) });
 *   <ZodForm form={form}>
 *       <form.AppField name="name">{(f) => <f.TextField label="Name" />}</form.AppField>
 *       <form.AppField name="active">{(f) => <f.SwitchField label="Active" />}</form.AppField>
 *       <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
 *   </ZodForm>
 *
 * Validation: the schema runs on blur, on submit and, while it refuses the form, on every edit. A failed save maps the server's problem+json `errors[]` onto the fields
 * and shows anything else above the buttons (the mutation's toast still comes from QueryProvider).
 * Builder-made forms do not use this: they are rendered by the form engine.
 */
import * as React from 'react';
import { createFormHook, createFormHookContexts, useStore } from '@tanstack/react-form';
import type { z } from 'zod';
import { Button } from '../primitives/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../primitives/field';
import { Input } from '../primitives/input';
import { Switch } from '../primitives/switch';
import { Textarea } from '../primitives/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select';
import { Alert, AlertDescription } from '../primitives/alert';
import { Spinner } from '../primitives/spinner';

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

/** A failed save split into per-field messages and a message for the form as a whole. */
export interface ServerFormErrors {
    form?: string;
    fields: Record<string, string>;
}

/**
 * Turns whatever a failed save threw into field and form messages. The design system knows nothing about the API, so the
 * app provides the mapping (its problem+json reader) once, with <ServerErrorsProvider>. Without a provider, the error's
 * own message goes to the form.
 */
export type ServerErrorMapper = (error: unknown, knownFields: string[]) => ServerFormErrors;

const errorMessageOnly: ServerErrorMapper = (error) => ({
    fields: {},
    form: error instanceof Error && error.message ? error.message : String(error)
});
const ServerErrorsContext = React.createContext<ServerErrorMapper>(errorMessageOnly);

export function ServerErrorsProvider({ map, children }: { map: ServerErrorMapper; children: React.ReactNode }) {
    return <ServerErrorsContext.Provider value={map}>{children}</ServerErrorsContext.Provider>;
}

/**
 * Messages of a field's current errors (Zod issues or plain strings), each once: the schema runs on blur and on submit,
 * and the form keeps both runs' errors, so the same message would otherwise show twice.
 */
export function messagesOf(errors: unknown[]): string[] {
    const messages = errors
        .map((e) =>
            typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String(e.message) : null
        )
        .filter((m): m is string => !!m);
    return [...new Set(messages)];
}

interface FieldChromeProps {
    label?: React.ReactNode;
    description?: React.ReactNode;
}

function FieldChrome({
    label,
    description,
    children,
    orientation
}: FieldChromeProps & { children: React.ReactNode; orientation?: 'vertical' | 'horizontal' }) {
    const field = useFieldContext<unknown>();
    const errors = useStore(field.store, (s): unknown[] => s.meta.errors);
    const touched = useStore(field.store, (s) => s.meta.isTouched || s.meta.errorMap.onServer !== undefined);
    const messages = touched ? messagesOf(errors) : [];
    return (
        <Field data-invalid={messages.length > 0 || undefined} orientation={orientation}>
            {label != null && <FieldLabel htmlFor={field.name}>{label}</FieldLabel>}
            {children}
            {description != null && <FieldDescription>{description}</FieldDescription>}
            {messages.length > 0 && <FieldError>{messages.join(' ')}</FieldError>}
        </Field>
    );
}

function TextField({
    label,
    description,
    ...input
}: FieldChromeProps & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'name' | 'id'>) {
    const field = useFieldContext<string>();
    const invalid = useStore(field.store, (s) => s.meta.isTouched && s.meta.errors.length > 0);
    return (
        <FieldChrome label={label} description={description}>
            <Input
                id={field.name}
                name={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={invalid || undefined}
                {...input}
            />
        </FieldChrome>
    );
}

function TextareaField({
    label,
    description,
    ...input
}: FieldChromeProps & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onBlur' | 'name' | 'id'>) {
    const field = useFieldContext<string>();
    const invalid = useStore(field.store, (s) => s.meta.isTouched && s.meta.errors.length > 0);
    return (
        <FieldChrome label={label} description={description}>
            <Textarea
                id={field.name}
                name={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={invalid || undefined}
                {...input}
            />
        </FieldChrome>
    );
}

function SwitchField({ label, description }: FieldChromeProps) {
    const field = useFieldContext<boolean>();
    return (
        <FieldChrome label={label} description={description} orientation="horizontal">
            <Switch
                id={field.name}
                checked={!!field.state.value}
                onCheckedChange={(v) => field.handleChange(v)}
                onBlur={field.handleBlur}
            />
        </FieldChrome>
    );
}

function SelectField({
    label,
    description,
    options,
    placeholder
}: FieldChromeProps & { options: { value: string; label: React.ReactNode }[]; placeholder?: string }) {
    const field = useFieldContext<string>();
    return (
        <FieldChrome label={label} description={description}>
            <Select value={field.state.value ?? ''} onValueChange={(v) => field.handleChange(v)}>
                <SelectTrigger id={field.name} onBlur={field.handleBlur} className="w-full">
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FieldChrome>
    );
}

function SubmitButton({ children, ...props }: React.ComponentProps<typeof Button>) {
    const form = useFormContext();
    // a failed save is no reason to refuse the next try: its message stays until then (`ZodForm` clears it)
    const [canSubmit, submitting] = useStore(
        form.store,
        (s) => [s.canSubmit || (s.isFieldsValid && s.errorMap.onServer !== undefined), s.isSubmitting] as const
    );
    return (
        <Button type="submit" disabled={!canSubmit || submitting} {...props}>
            {submitting && <Spinner />}
            {children}
        </Button>
    );
}

/** The form-level error (server failure not tied to a field). */
function FormError() {
    const form = useFormContext();
    const error = useStore(form.store, (s): unknown => s.errorMap.onServer);
    if (!error) return null;
    return (
        <Alert variant="destructive">
            <AlertDescription>{typeof error === 'string' ? error : ''}</AlertDescription>
        </Alert>
    );
}

export const { useAppForm, withForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: { TextField, TextareaField, SwitchField, SelectField },
    formComponents: { SubmitButton, FormError }
});

/** `useAppForm` with a Zod schema as the validator and server errors mapped onto the fields. */
export function useZodForm<TSchema extends z.ZodType<Record<string, unknown>>>({
    schema,
    defaultValues,
    onSubmit
}: {
    schema: TSchema;
    defaultValues: z.input<TSchema>;
    onSubmit: (value: z.output<TSchema>) => unknown;
}) {
    // Zod issues -> { fields: { 'a.b': message } }, the form-level validator shape that TanStack Form spreads onto the fields.
    const validate = ({ value }: { value: unknown }) => {
        const result = schema.safeParse(value);
        if (result.success) return undefined;
        const fields: Record<string, string> = {};
        for (const issue of result.error.issues) {
            const path = issue.path.map(String).join('.');
            if (path && !fields[path]) fields[path] = issue.message;
        }
        return { fields };
    };
    const mapServerErrors = React.useContext(ServerErrorsContext);
    return useAppForm({
        defaultValues,
        validators: { onBlur: validate, onSubmit: validate },
        listeners: {
            // A verdict was about the values it saw. An edit drops the server's, and, while something refuses the form,
            // checks it again: else a refusal outlives what caused it, and the submit button stays disabled (Enter does
            // nothing) until the person happens to leave a field.
            onChange: ({ formApi, fieldApi }) => {
                if (fieldApi.state.meta.errorMap.onServer !== undefined)
                    fieldApi.setMeta((m) => ({ ...m, errorMap: { ...m.errorMap, onServer: undefined } }));
                if (formApi.state.errorMap.onServer !== undefined) formApi.setErrorMap({ onServer: undefined });
                if (!formApi.state.canSubmit) void formApi.validate('submit');
            }
        },
        onSubmit: async ({ value, formApi }) => {
            try {
                await onSubmit(schema.parse(value));
            } catch (err) {
                const known = Object.keys(formApi.state.fieldMeta);
                const { fields, form } = mapServerErrors(err, known);
                for (const [name, message] of Object.entries(fields)) {
                    formApi.setFieldMeta(name as never, (m) => ({
                        ...m,
                        isTouched: true,
                        errorMap: { ...m.errorMap, onServer: message }
                    }));
                }
                formApi.setErrorMap({ onServer: form as never });
            }
        }
    });
}

/** `<form>` element wired to a `useZodForm` form (prevents the native submit, renders the form-level error). */
/** The parts of a `useZodForm` form that `ZodForm` needs. */
interface ZodFormApi {
    handleSubmit: () => unknown;
    setErrorMap: (errorMap: { onServer: undefined }) => void;
    AppForm: React.ComponentType<React.PropsWithChildren>;
    FormError: React.ComponentType;
}

export function ZodForm({
    form,
    children,
    className
}: {
    form: ZodFormApi;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <form
            noValidate
            className={className ?? 'flex flex-col gap-4'}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // the last failure's message goes with the new try; the form would refuse the try while it stands
                form.setErrorMap({ onServer: undefined });
                void form.handleSubmit();
            }}
        >
            {children}
            <form.AppForm>
                <form.FormError />
            </form.AppForm>
        </form>
    );
}
