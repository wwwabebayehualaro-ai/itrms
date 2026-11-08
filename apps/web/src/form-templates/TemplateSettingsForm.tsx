'use client';

/**
 * A form's own settings (not its fields): name, category, active; the form key and version are shown, not changed. The fields are edited in the
 * builder; saving here keeps them as they are.
 */
import { useMemo } from 'react';
import { z } from 'zod';
import { ZodForm, useNotify, useZodForm } from '@itrms/ui';
import { useFormsLanguages, useTemplateMutations } from '@itrms/form-engine/renderer';
import { LANGUAGE_ENDONYMS } from '@itrms/schemas';
import { useText } from '@/lib/preferences';
import type { IFormTemplate } from '@/types/template_builder/form';

const formSchema = (t: (key: string, values?: Record<string, string>) => string) =>
    z.object({
        // the forms API's limit; Amharic and English are required, the other languages optional
        names: z
            .record(
                z.string(),
                z
                    .string()
                    .trim()
                    .max(200, t('common.validation.maxChars', { max: '200' }))
            )
            .superRefine((names, ctx) => {
                for (const required of ['am', 'en'])
                    if (!names[required])
                        ctx.addIssue({
                            code: 'custom',
                            path: [required],
                            message: t('shell.templates.settingsForm.nameRequired')
                        });
            }),
        category: z
            .string()
            .trim()
            .max(100, t('common.validation.maxChars', { max: '100' })),
        is_active: z.boolean()
    });

const changed = (a: Record<string, string>, b: Record<string, string | undefined>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].some((k) => (a[k] ?? '') !== (b[k] ?? ''));
};

export function TemplateSettingsForm({ template, onSaved }: { template: IFormTemplate; onSaved: () => void }) {
    const { t } = useText();
    const notify = useNotify();
    const schema = useMemo(() => formSchema(t), [t]);
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
            notify.success(t('shell.templates.settingsForm.saved'));
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
                                    label={t('shell.templates.settingsForm.nameLabel', {
                                        language: LANGUAGE_ENDONYMS[l as keyof typeof LANGUAGE_ENDONYMS] ?? l
                                    })}
                                    description={l === 'am' ? t('shell.templates.settingsForm.nameHint') : undefined}
                                    maxLength={200}
                                />
                            )}
                        </form.AppField>
                    ))}
                    <form.AppField name="category">
                        {(f) => <f.TextField label={t('shell.templates.settingsForm.category')} maxLength={100} />}
                    </form.AppField>
                </div>
                <form.AppField name="is_active">
                    {(f) => (
                        <f.SwitchField
                            label={t('shell.templates.settingsForm.active')}
                            description={t('shell.templates.settingsForm.activeHint')}
                        />
                    )}
                </form.AppField>

                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-muted-foreground">{t('shell.templates.settingsForm.key')}</dt>
                        <dd className="font-mono">{template.slug}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">{t('shell.templates.settingsForm.version')}</dt>
                        <dd>{template.version}</dd>
                    </div>
                </dl>

                <div className="flex justify-end gap-2">
                    <form.AppForm>
                        <form.SubmitButton>{t('shell.templates.settingsForm.save')}</form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </div>
    );
}
