'use client';

import { memo, useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@itrms/ui';
import { readDocument } from '../core';
import { engineTranslator } from '../core/messages';
import { useFormsLanguages } from '../host/FormsHost';
import { EngineForm, type EngineFormProps } from './EngineForm';
import { unsupportedFields } from './kit';

export type FormRendererProps = EngineFormProps;

/**
 * A saved template as a working form (or, with `readOnly` / `view`, as a record or a report): the form engine on the design
 * system (`renderer/EngineForm`). A field whose type the field kit does not have is left out and named above the form, so a
 * form never fails silently.
 */
function FormRenderer(props: FormRendererProps) {
    const { language: shown } = useFormsLanguages();
    const language = props.language ?? shown;
    const t = useMemo(() => engineTranslator(language), [language]);
    const missing = useMemo(() => {
        const doc = readDocument({ fields: props.fields }, { language });
        return [
            ...unsupportedFields(doc.fields).map((f) => f.label || f.id),
            ...doc.invalid.map((i) =>
                t('form-engine.renderer.notice.invalidField', { number: String(i.index + 1), message: i.message })
            )
        ];
    }, [props.fields, language, t]);
    return (
        <>
            {missing.length > 0 && (
                <div className="mb-3" data-slot="notice">
                    <Alert>
                        <AlertTitle>{t('form-engine.renderer.notice.title')}</AlertTitle>
                        <AlertDescription>
                            {t('form-engine.renderer.notice.body', { fields: missing.join(', ') })}
                        </AlertDescription>
                    </Alert>
                </div>
            )}
            <EngineForm {...props} submissionId={props.submissionId ?? null} />
        </>
    );
}

export default memo(FormRenderer);
