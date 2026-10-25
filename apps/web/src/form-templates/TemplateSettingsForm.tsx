'use client';

/**
 * A form's own settings (not its fields): name, category, active; the form key and version are shown, not changed. The fields are edited in the
 * builder; saving here keeps them as they are.
 */
import { z } from 'zod';
import { ZodForm, useNotify, useZodForm } from '@itrms/ui';
import { useTemplateMutations } from '@itrms/form-engine/renderer';
import type { IFormTemplate } from '@/types/template_builder/form';

const schema = z.object({
    name: z.string().trim().min(1, 'A form needs a name').max(255, 'At most 255 characters'),
    category: z.string().trim().max(100, 'At most 100 characters'),
    is_active: z.boolean()
});

export function TemplateSettingsForm({ template, onSaved }: { template: IFormTemplate; onSaved: () => void }) {
    const notify = useNotify();
    const { update } = useTemplateMutations();

    const form = useZodForm({
        schema,
        defaultValues: {
            name: template.name ?? '',
            category: template.category ?? '',
            is_active: template.is_active ?? true
        },
        onSubmit: async (v) => {
            await update.mutateAsync({
                id: template.id as string,
                data: {
                    ...v,
                    category: v.category || undefined,
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
                    <form.AppField name="name">
                        {(f) => (
                            <f.TextField
                                label="Name"
                                description="What people see in the list of forms."
                                maxLength={255}
                            />
                        )}
                    </form.AppField>
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
