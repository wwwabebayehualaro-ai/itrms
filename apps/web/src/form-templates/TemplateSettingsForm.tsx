'use client';

/**
 * A form's own settings (not its fields): name, category, active; the form key and version are shown, not changed. The fields are edited in the
 * builder; saving here keeps them as they are.
 */
import { z } from 'zod';
import { ZodForm, useNotify, useZodForm } from '@itrms/ui';
import { useFormsLanguages, useTemplateMutations } from '@itrms/form-engine/renderer';
import { LANGUAGE_ENDONYMS } from '@itrms/schemas';
import type { IFormTemplate } from '@/types/template_builder/form';

const schema = z.object({
    // the forms API's limit; Amharic and English are required, the other languages optional
    names: z.record(z.string(), z.string().trim().max(200, 'At most 200 characters')).superRefine((names, ctx) => {
        for (const required of ['am', 'en'])
            if (!names[required]) ctx.addIssue({ code: 'custom', path: [required], message: 'A form needs a name' });
    }),
    category: z.string().trim().max(100, 'At most 100 characters'),
    is_active: z.boolean()
});

const changed = (a: Record<string, string>, b: Record<string, string | undefined>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].some((k) => (a[k] ?? '') !== (b[k] ?? ''));
};

export function TemplateSettingsForm({ template, onSaved }: { template: IFormTemplate; onSaved: () => void }) {
    const notify = useNotify();
    const { update } = useTemplateMutations();
    const { languages } = useFormsLanguages();
    const stored = template.names ?? { am: template.name, en: template.name };

    const form = useZodForm({
        schema,
        defaultValues: {
            names: Object.fromEntries(languages.map((l) => [l, stored[l] ?? ''])),
            category: template.category ?? '',
            is_active: template.is_active ?? true
        },
        onSubmit: async (v) => {
            // the shown languages override the stored names; a name in a language the installation no longer lists stays
            const shown = Object.fromEntries(languages.map((l) => [l, v.names[l] ?? '']));
            const names = Object.fromEntries(Object.entries({ ...stored, ...shown }).filter(([, text]) => text !== ''));
            await update.mutateAsync({
                id: template.id as string,
                data: {
                    // the names (the complete map, empty optional languages dropped) only when a shown one changed
                    ...(changed(shown, Object.fromEntries(languages.map((l) => [l, stored[l] ?? ''])))
                        ? { names }
                        : {}),
                    // an emptied category is cleared (sent as null)
                    category: v.category,
                    is_active: v.is_active,
                    ...(template.row_version !== undefined && { row_version: template.row_version })
                } as Partial<IFormTemplate>
            });
            notify.success('Form settings saved');
            onSaved();
        }
    });

    return (
        <div data-template-settings>
            <ZodForm form={form}>
                <div className="grid gap-4 sm:grid-cols-2">
                    {languages.map((l) => (
                        <form.AppField key={l} name={`names.${l}`}>
                            {(f) => (
                                <f.TextField
                                    label={`Name (${LANGUAGE_ENDONYMS[l as keyof typeof LANGUAGE_ENDONYMS] ?? l})`}
                                    description={l === 'am' ? 'What people see in the list of forms.' : undefined}
                                    maxLength={200}
                                />
                            )}
                        </form.AppField>
                    ))}
                    <form.AppField name="category">
                        {(f) => <f.TextField label="Category" maxLength={100} />}
                    </form.AppField>
                </div>
                <form.AppField name="is_active">
                    {(f) => <f.SwitchField label="Active" description="An inactive form cannot be filled in." />}
                </form.AppField>

                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-muted-foreground">Form key</dt>
                        <dd className="font-mono">{template.slug}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">Version</dt>
                        <dd>{template.version}</dd>
                    </div>
                </dl>

                <div className="flex justify-end gap-2">
                    <form.AppForm>
                        <form.SubmitButton>Save settings</form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </div>
    );
}
