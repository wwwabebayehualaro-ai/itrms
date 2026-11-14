'use client';

/**
 * A fill's moments for the form's analytics (task 1.13f): opened, a wizard step reached, stopped by the checks (the keys of the
 * fields in error), submitted (the seconds it took). No answer ever leaves with them. Sent and forgotten: a report that fails
 * never stops or slows the person filling the form in. Off where nobody is filling a real form in (the builder's preview, a
 * read-only view) and for a form with no published version to count against.
 */
import { useMemo, useRef, useState } from 'react';

import { FORMS_API } from '../api/wire';
import { useFormsClient } from '../host/FormsHost';

export interface FillReporter {
    opened: () => void;
    step: (stepId: string) => void;
    blocked: (fieldKeys: readonly string[], stepId?: string) => void;
    submitted: () => void;
}

const NOTHING: FillReporter = {
    opened: () => undefined,
    step: () => undefined,
    blocked: () => undefined,
    submitted: () => undefined
};

/** A random v4 UUID for one sitting (the browser's generator; one without `randomUUID` still has `getRandomValues`). */
function randomId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function useFillReporter(
    formId: string | undefined,
    versionId: string | null | undefined,
    on: boolean
): FillReporter {
    const client = useFormsClient();
    const [fill] = useState(randomId);
    const started = useRef<number | null>(null);
    return useMemo(() => {
        if (!on || !formId || !versionId) return NOTHING;
        const send = (body: Record<string, unknown>) =>
            void Promise.resolve()
                .then(() =>
                    client.post(`${FORMS_API.forms}/${formId}/events`, { formVersionId: versionId, fill, ...body })
                )
                .catch(() => undefined);
        return {
            opened: () => {
                if (started.current !== null) return;
                started.current = Date.now();
                send({ kind: 'opened' });
            },
            step: (stepId) => send({ kind: 'step', step: stepId }),
            blocked: (fieldKeys, stepId) =>
                send({
                    kind: 'blocked',
                    fieldKeys: [...new Set(fieldKeys)].slice(0, 200),
                    ...(stepId ? { step: stepId } : {})
                }),
            submitted: () =>
                send({
                    kind: 'submitted',
                    seconds: Math.min(604_800, Math.round((Date.now() - (started.current ?? Date.now())) / 1000))
                })
        };
    }, [client, fill, formId, versionId, on]);
}
