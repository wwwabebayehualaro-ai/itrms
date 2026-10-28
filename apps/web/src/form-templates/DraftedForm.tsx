'use client';

/**
 * A request filled in with a draft kept as the person types (task 0.20c): the published form, started from a resumed
 * draft's answers, saved in this browser and on the server (lib/drafts), and filed with the draft so the draft goes.
 * A line under the title says where the draft is kept now.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, Check, Loader2, HardDrive, TriangleAlert } from 'lucide-react';
import { keepsServerOnly, readDocument, withoutSensitive } from '@itrms/form-engine/core';
import { PublishedFormRenderer, usePublishedTemplate } from '@itrms/form-engine/renderer';
import { Alert, AlertDescription, InlineStatus } from '@itrms/ui';

import { useAuthStore } from '@/lib/auth/authStore';
import { resumeValues, useDraftSession, type DraftStart, type DraftStatus, type Resumed } from '@/lib/drafts';
import { useText } from '@/lib/preferences';
import type { IFormTemplate } from '@/types/template_builder/form';

interface Props {
    template: IFormTemplate;
    /** a draft to go on with */
    start?: DraftStart;
    onFormSubmit?: (submission: IFormSubmissionBase) => void | Promise<unknown>;
    onSuccess?: () => void;
    submitLabel?: string;
}

export function DraftedForm({ template, start, onFormSubmit, onSuccess, submitLabel }: Props) {
    const userId = useAuthStore((s) => s.user?.id);
    const { language, t } = useText();
    const published = usePublishedTemplate(template.id as string);
    const [resumed, setResumed] = useState<Resumed | null>(start ? null : { values: {}, conflict: false, start: {} });
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (start && userId)
            resumeValues(userId, start)
                .then(setResumed)
                .catch(() => setFailed(true));
    }, [start, userId]);
    const fields = useMemo(() => {
        const config = published.data?.form_config;
        return config ? readDocument(Array.isArray(config) ? { fields: config } : config, { language }).fields : null;
    }, [published.data, language]);

    // the published form's own states (loading, not published) are the renderer's
    if (failed) return <InlineStatus error={t('forms.draft.resumeFailed')} className="p-4" />;
    if (!userId || !published.data || !fields || resumed === null)
        return published.error ? (
            <PublishedFormRenderer bare template={template} onFormSubmit={onFormSubmit} onSuccess={onSuccess} />
        ) : (
            <InlineStatus loading className="p-4" />
        );
    return (
        <DraftFill
            userId={userId}
            template={template}
            versionId={published.data.version_id}
            fields={fields}
            start={resumed.start}
            initial={resumed.values}
            conflict={resumed.conflict}
            onFormSubmit={onFormSubmit}
            onSuccess={onSuccess}
            submitLabel={submitLabel}
        />
    );
}

function DraftFill({
    userId,
    template,
    versionId,
    fields,
    start,
    initial,
    conflict,
    onFormSubmit,
    onSuccess,
    submitLabel
}: Props & {
    userId: string;
    versionId: string;
    fields: ReturnType<typeof readDocument>['fields'];
    initial: Record<string, unknown>;
    conflict: boolean;
}) {
    const { t } = useText();
    const session = useDraftSession({
        userId,
        formId: template.id as string,
        versionId,
        local: (values) => withoutSensitive(fields, values),
        start
    });
    // the form reports its first values as it opens: a draft starts with a change, not with opening the form
    const opened = useRef<string | null>(null);
    return (
        <div className="flex flex-col gap-3">
            {conflict && (
                <Alert data-draft-conflict>
                    <AlertDescription>{t('forms.draft.conflict')}</AlertDescription>
                </Alert>
            )}
            <DraftStatusLine status={session.status} serverOnly={keepsServerOnly(fields)} />
            <PublishedFormRenderer
                bare
                template={template}
                initialValues={initial}
                onValuesChange={(values) => {
                    const now = JSON.stringify(values);
                    if (opened.current === null) opened.current = now;
                    else if (now !== opened.current) session.change(values);
                }}
                onFormSubmit={async (payload) => {
                    // a save on its way first: the filing then names the draft it saved
                    await session.settle();
                    const draftId = session.draftId();
                    const result = await onFormSubmit?.({ ...payload, ...(draftId ? { draft_id: draftId } : {}) });
                    await session.filed();
                    return result;
                }}
                onSuccess={onSuccess}
                submitLabel={submitLabel}
            />
        </div>
    );
}

const LOOK: Record<Exclude<DraftStatus, 'idle'>, { icon: typeof Check; key: string; tone: string }> = {
    local: { icon: HardDrive, key: 'forms.draft.status.local', tone: 'text-muted-foreground' },
    saving: { icon: Loader2, key: 'forms.draft.status.saving', tone: 'text-muted-foreground' },
    saved: { icon: Check, key: 'forms.draft.status.saved', tone: 'text-muted-foreground' },
    offline: { icon: CloudOff, key: 'forms.draft.status.offline', tone: 'text-warning-foreground' },
    error: { icon: TriangleAlert, key: 'forms.draft.status.error', tone: 'text-destructive' }
};

function DraftStatusLine({ status, serverOnly }: { status: DraftStatus; serverOnly: boolean }) {
    const { t } = useText();
    const look = status === 'idle' ? null : LOOK[status];
    return (
        <div className="flex flex-col gap-1 text-xs" data-draft-status={status} aria-live="polite">
            {look ? (
                <span className={`flex items-center gap-1.5 ${look.tone}`}>
                    <look.icon className={`size-3.5 ${status === 'saving' ? 'animate-spin' : ''}`} aria-hidden />
                    {t(look.key)}
                </span>
            ) : (
                <span className="text-muted-foreground">{t('forms.draft.status.idle')}</span>
            )}
            {serverOnly && <span className="text-muted-foreground">{t('forms.draft.sensitive')}</span>}
        </div>
    );
}
