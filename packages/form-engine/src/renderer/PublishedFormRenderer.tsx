'use client';

import React from 'react';
import { isRequestError } from '../host/client';
import { Alert, AlertDescription, AlertTitle, InlineStatus } from '@itrms/ui';
import { requestErrorMessage } from '../host/client';
import FormRenderer from './FormRenderer';
import { usePublishedTemplate } from '../api/templates';
import { useFormsLanguages } from '../host/FormsHost';
import { engineTranslator } from '../core/messages';
import type { FormField, FormTemplate } from '@itrms/schemas';

type RendererProps = Omit<React.ComponentProps<typeof FormRenderer>, 'fields' | 'template'>;

/**
 * Fill in a form: renders the **published** version of `template` (what the server accepts requests for), never the working copy
 * the builder edits. Says so when the form has not been published yet.
 */
export function PublishedFormRenderer({ template, ...props }: RendererProps & { template: FormTemplate }) {
    const { data, isPending, error } = usePublishedTemplate(template.id);
    const { language: shown } = useFormsLanguages();
    const t = engineTranslator(props.language ?? shown);
    if (isPending) return <InlineStatus loading className="p-4" />;
    if (error) {
        const notPublished =
            isRequestError(error) && (error.response?.data as { code?: string } | undefined)?.code === 'not_configured';
        return (
            <div data-slot="notice">
                <Alert>
                    <AlertTitle>
                        {t(
                            notPublished
                                ? 'form-engine.renderer.published.notYet'
                                : 'form-engine.renderer.published.loadFailed'
                        )}
                    </AlertTitle>
                    <AlertDescription>
                        {notPublished
                            ? t('form-engine.renderer.published.notYetBody')
                            : requestErrorMessage(error, undefined, t)}
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
                // what the request is filed on: the version shown, not whatever is published at submit time
                published_version_id: data.version_id,
                form_config: config,
                file_relations: data.file_relations as FormTemplate['file_relations']
            }}
        />
    );
}
