'use client';

import React from 'react';
import { isAxiosError } from 'axios';
import { Alert, AlertDescription, AlertTitle, InlineStatus } from '@platform/ui';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { IFormTemplate } from '@/types/template_builder/form';
import FormRenderer from './FormRenderer';
import { usePublishedTemplate } from './api/templates';

type RendererProps = Omit<React.ComponentProps<typeof FormRenderer>, 'fields' | 'template'>;

/**
 * Fill in a form: renders the **published** version of `template` (what the server accepts requests for), never the working copy
 * the builder edits. Says so when the form has not been published yet.
 */
export function PublishedFormRenderer({ template, ...props }: RendererProps & { template: IFormTemplate }) {
    const { data, isPending, error } = usePublishedTemplate(template.id as string | undefined);
    if (isPending) return <InlineStatus loading className="p-4" />;
    if (error) {
        const notPublished = isAxiosError(error) && (error.response?.data as { code?: string } | undefined)?.code === 'form_not_published';
        return (
            <div data-slot="notice">
                <Alert>
                    <AlertTitle>{notPublished ? 'This form is not published yet' : 'This form could not be loaded'}</AlertTitle>
                    <AlertDescription>{notPublished ? 'It can be filled in once it has been published (and approved, where approval is required).' : getApiErrorMessage(error)}</AlertDescription>
                </Alert>
            </div>
        );
    }
    const config = (Array.isArray(data.form_config) ? { fields: data.form_config } : data.form_config) as IFormTemplate['form_config'];
    return <FormRenderer {...props} fields={config?.fields || []} template={{ ...template, form_config: config, file_relations: data.file_relations as IFormTemplate['file_relations'] }} />;
}
