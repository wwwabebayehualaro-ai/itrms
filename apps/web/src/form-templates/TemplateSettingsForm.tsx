'use client';

/**
 * A form's own settings (not its fields): name, address (slug), version, category, active, thumbnail. The fields are edited in the
 * builder; saving here keeps them as they are.
 */
import { useRef, useState } from 'react';
import { z } from 'zod';
import { ImageUp, WandSparkles, X } from 'lucide-react';
import {
    Button,
    Field,
    FieldDescription,
    FieldLabel,
    IconButton,
    Spinner,
    ZodForm,
    useNotify,
    useZodForm
} from '@itrms/ui';
import { useTemplateMutations } from '@itrms/form-engine/renderer';
import { useFileUpload, useFilePreview } from '@/lib/api/useFileUpload';
import type { IFormTemplate } from '@/types/template_builder/form';

const slugOf = (name: string) =>
    name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const schema = z.object({
    name: z.string().trim().min(1, 'A form needs a name').max(255, 'At most 255 characters'),
    slug: z
        .string()
        .trim()
        .min(1, 'A form needs an address')
        .max(255, 'At most 255 characters')
        .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and hyphens only'),
    version: z
        .string()
        .trim()
        .regex(/^\d+\.\d+\.\d+$/, 'Three numbers, e.g. 1.0.0'),
    category: z.string().trim().max(100, 'At most 100 characters'),
    is_active: z.boolean()
});

interface Thumbnail {
    file_id: string;
    url?: string;
    content_type: string;
}

export function TemplateSettingsForm({ template, onSaved }: { template: IFormTemplate; onSaved: () => void }) {
    const notify = useNotify();
    const { update } = useTemplateMutations();
    const { uploadFile, loading: uploading } = useFileUpload();
    const current = (template.file_relations as Thumbnail[] | undefined)?.[0];
    const [thumb, setThumb] = useState<Thumbnail | null | undefined>(undefined); // undefined: unchanged
    const shown = thumb === undefined ? current : thumb;
    const preview = useFilePreview(shown?.file_id);
    const fileInput = useRef<HTMLInputElement>(null);

    const form = useZodForm({
        schema,
        defaultValues: {
            name: template.name ?? '',
            slug: template.slug ?? '',
            version: template.version ?? '1.0.0',
            category: template.category ?? '',
            is_active: template.is_active ?? true
        },
        onSubmit: async (v) => {
            await update.mutateAsync({
                id: template.id as string,
                data: {
                    ...v,
                    category: v.category || undefined,
                    ...(thumb !== undefined && {
                        thumbnail_url: thumb?.url ?? null,
                        file_relations: thumb ? [{ file_id: thumb.file_id, content_type: thumb.content_type }] : []
                    }),
                    ...(template.row_version !== undefined && { row_version: template.row_version })
                } as Partial<IFormTemplate>
            });
            notify.success('Form settings saved');
            onSaved();
        }
    });

    const upload = async (file: File) => {
        const r = await uploadFile({ file });
        setThumb({ file_id: r.file_id, url: r.url, content_type: r.content_type });
    };

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
                    <form.AppField name="slug">
                        {(f) => (
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <f.TextField
                                        label="Address"
                                        description="Lowercase, digits and hyphens."
                                        maxLength={255}
                                    />
                                </div>
                                <IconButton
                                    label="Make the address from the name"
                                    className="mb-6"
                                    onClick={() => f.handleChange(slugOf(form.getFieldValue('name') ?? ''))}
                                >
                                    <WandSparkles />
                                </IconButton>
                            </div>
                        )}
                    </form.AppField>
                    <form.AppField name="version">{(f) => <f.TextField label="Version" />}</form.AppField>
                    <form.AppField name="category">
                        {(f) => <f.TextField label="Category" maxLength={100} />}
                    </form.AppField>
                </div>
                <form.AppField name="is_active">
                    {(f) => <f.SwitchField label="Active" description="An inactive form cannot be filled in." />}
                </form.AppField>

                <Field>
                    <FieldLabel>Thumbnail</FieldLabel>
                    <div className="flex items-center gap-3">
                        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted">
                            {shown && preview.data?.base64 ? (
                                <img src={preview.data.base64} alt="Thumbnail" className="size-full object-cover" />
                            ) : shown && preview.isPending ? (
                                <Spinner />
                            ) : (
                                <ImageUp className="size-6 text-muted-foreground" />
                            )}
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
                            aria-label="Thumbnail image"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => fileInput.current?.click()}
                        >
                            {uploading ? <Spinner /> : <ImageUp />}
                            {shown ? 'Replace' : 'Upload'}
                        </Button>
                        {shown && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setThumb(null)}>
                                <X />
                                Remove
                            </Button>
                        )}
                    </div>
                    <FieldDescription>Shown on the form&apos;s card.</FieldDescription>
                </Field>

                <div className="flex justify-end gap-2">
                    <form.AppForm>
                        <form.SubmitButton>Save settings</form.SubmitButton>
                    </form.AppForm>
                </div>
            </ZodForm>
        </div>
    );
}
