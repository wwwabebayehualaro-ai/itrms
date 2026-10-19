'use client';

import { memo, useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@itrms/ui';
import { readDocument } from './core';
import { EngineForm, type EngineFormProps } from './renderer/EngineForm';
import { unsupportedFields } from './renderer/kit';

export type FormRendererProps = EngineFormProps;

/**
 * A saved template as a working form (or, with `readOnly` / `view`, as a record or a report): the form engine on the design
 * system (`renderer/EngineForm`). A field whose type the field kit does not have is left out and named above the form, so a
 * form never fails silently.
 */
function FormRenderer(props: FormRendererProps) {
    const missing = useMemo(() => {
        const doc = readDocument({ fields: props.fields });
        return [
            ...unsupportedFields(doc.fields).map((f) => f.label || f.id),
            ...doc.invalid.map((i) => `field ${i.index + 1} (${i.message})`)
        ];
    }, [props.fields]);
    return (
        <>
            {missing.length > 0 && (
                <div className="mb-3" data-slot="notice">
                    <Alert>
                        <AlertTitle>Part of this form cannot be shown</AlertTitle>
                        <AlertDescription>
                            Not shown: {missing.join(', ')}. Open the form in the builder to replace these fields.
                        </AlertDescription>
                    </Alert>
                </div>
            )}
            <EngineForm {...props} submissionId={props.submissionId ?? null} />
        </>
    );
}

export default memo(FormRenderer);
