'use client';

import React from 'react';
import { isRequestError } from '../host/client';
import { Alert, AlertDescription, AlertTitle, InlineStatus } from '@itrms/ui';
import { requestErrorMessage } from '../host/client';
import FormRenderer from './FormRenderer';
import { usePublishedTemplate } from '../api/templates';
import type { FormField, FormTemplate } from '@itrms/schemas';

type RendererProps = Omit<React.ComponentProps<typeof FormRenderer>, 'fields' | 'template'>;

/**
 * Fill in a form: renders the **published** version of `template` (what the server accepts requests for), never the working copy
 * the builder edits. Says so when the form has not been published yet.
 */
export function PublishedFormRenderer({ template, ...props }: RendererProps & { template: FormTemplate }) {
    const { data, isPending, error } = usePublishedTemplate(template.id);
    if (isPending) return <InlineStatus loading className="p-4" />;
    if (error) {
        const notPublished =
            isRequestError(error) &&
            (error.response?.data as { code?: string } | undefined)?.code === 'form_not_published';
        return (
            <div data-slot="notice">
                <Alert>
                    <AlertTitle>
                        {notPublished ? 'This form is not published yet' : 'This form could not be loaded'}
                    </AlertTitle>
                    <AlertDescription>
                        {notPublished
                            ? 'It can be filled in once it has been published (and approved, where approval is required).'
                            : requestErrorMessage(error)}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }
    const config = Array.isArray(data.form_config) ? { fields: data.form_config } : data.form_config;
    return (
        <FormRenderer
            {...props}
            fields={Array.isArray(config.fields) ? (config.fields as FormField[]) : []}
            template={{
                ...template,
                form_config: config,
                file_relations: data.file_relations as FormTemplate['file_relations']
            }}
        />
    );
}
