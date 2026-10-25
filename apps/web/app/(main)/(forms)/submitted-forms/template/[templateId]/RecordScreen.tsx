'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileText, History, Info, Pencil, Send, Trash2 } from 'lucide-react';
import {
    FormRenderer,
    useSubmissionMutations,
    useSubmissionQuery,
    useTemplateQuery,
    useCanChangeRequests
} from '@itrms/form-engine/renderer';
import { storedFieldsOf } from '@itrms/schemas';
import {
    titleOf,
    useLabeler,
    useRecordForm,
    useRecordHistory,
    useViewSchema,
    type HistoryEntry
} from '@itrms/form-engine/viewer';
import {
    Alert,
    AlertDescription,
    Button,
    InlineStatus,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    confirmAction,
    useNotify
} from '@itrms/ui';
import { getApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { RequestEditorDialog } from './RequestEditorDialog';

const ACTION: Record<string, { label: string; icon: typeof Send }> = {
    create: { label: 'Submitted', icon: Send },
    update: { label: 'Changed', icon: Pencil },
    delete: { label: 'Deleted', icon: Trash2 }
};
const HIDDEN_CHANGES = new Set(['row_version', 'template_version_id', 'updated_at', 'updated_by']);

/** One request, as a page you can link to: the form as it was filled in, who changed what, and the actions. */
export function RecordScreen({ templateId, submissionId }: { templateId: string; submissionId: string }) {
    const router = useRouter();
    const from = useSearchParams().get('from');
    const notify = useNotify();
    // a request changes only through its case's workflow (task 0.19)
    const canEdit = useCanChangeRequests();
    const canDelete = canEdit;
    const back = `/submitted-forms/template/${templateId}${from ? `?${from}` : ''}`;

    const { data: template } = useTemplateQuery(templateId);
    const { data: submission, isPending, error } = useSubmissionQuery(submissionId);
    const { data: record } = useRecordForm(submissionId);
    const history = useRecordHistory(submissionId);
    const { data: schema } = useViewSchema(templateId);
    const labeler = useLabeler(schema);
    const { remove } = useSubmissionMutations();
    const [editing, setEditing] = useState(false);

    if (isPending) return <InlineStatus loading />;
    if (error || !submission) return <InlineStatus error={getApiErrorMessage(error, 'This request was not found')} />;

    const row = { ...submission } as any;
    const title = schema ? titleOf(row, schema, labeler) : `Request ${String(submission.id).slice(0, 8)}`;
    const fields =
        (Array.isArray(record?.form_config) ? record?.form_config : record?.form_config?.fields) ??
        (template ? storedFieldsOf(template.form_config) : []);
    const renderTemplate =
        template && record
            ? {
                  ...template,
                  form_config: Array.isArray(record.form_config) ? { fields: record.form_config } : record.form_config
              }
            : template;

    const confirmDelete = () =>
        void confirmAction({
            header: 'Delete this request?',
            message: 'This cannot be undone.',
            acceptLabel: 'Delete',
            danger: true,
            onAccept: async () => {
                await remove.mutateAsync(submission.id as string);
                notify.success('Request deleted');
                router.push(back);
            }
        });

    return (
        <div className="flex flex-col gap-4" data-record-page={submission.id as string}>
            <Link href={back} className="flex w-fit items-center gap-2 text-sm text-primary hover:underline">
                <ArrowLeft className="size-4" />
                {template?.name ?? 'Requests'}
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-semibold">{title}</h1>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>Office {submission.handling_unit_name ?? '—'}</span>
                        <span>Submitted by {submission.submitted_by_name ?? '—'}</span>
                        <span>{formatDateTime(submission.created_at)}</span>
                        {submission.updated_at && submission.updated_at !== submission.created_at && (
                            <span>updated {formatDateTime(submission.updated_at)}</span>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    {canDelete && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={confirmDelete}
                        >
                            <Trash2 />
                            Delete
                        </Button>
                    )}
                </div>
            </div>

            {record && !record.current && (
                <Alert data-form-changed>
                    <Info />
                    <AlertDescription>
                        The form was changed after this request was filled in. It is shown the way it was submitted;
                        editing it moves it to the current form.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs defaultValue="request">
                <TabsList>
                    <TabsTrigger value="request">
                        <FileText />
                        Request
                    </TabsTrigger>
                    <TabsTrigger value="history">
                        <History />
                        History
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="request" className="pt-2">
                    {renderTemplate && record ? (
                        <FormRenderer
                            key={`${submission.id}-${submission.version}`}
                            bare
                            readOnly
                            fields={fields}
                            template={renderTemplate}
                            initialValues={submission.submission_data}
                        />
                    ) : (
                        <InlineStatus loading />
                    )}
                </TabsContent>
                <TabsContent value="history" className="pt-2">
                    {history.isPending ? (
                        <InlineStatus loading />
                    ) : history.error ? (
                        <InlineStatus error={getApiErrorMessage(history.error)} />
                    ) : (
                        <ol className="relative ml-3 border-l pl-6" aria-label="History">
                            {(history.data ?? []).map((e: HistoryEntry, i) => {
                                const Icon = ACTION[e.action]?.icon ?? Pencil;
                                return (
                                    <li key={i} className="relative pb-5" data-history={e.action}>
                                        <span className="absolute top-0 -left-[2.3rem] flex size-7 items-center justify-center rounded-full border bg-background">
                                            <Icon className="size-3.5 text-muted-foreground" />
                                        </span>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm">
                                                <strong>{ACTION[e.action]?.label ?? e.action}</strong> by{' '}
                                                {e.actor_name ?? 'someone'}{' '}
                                                <span className="text-muted-foreground">
                                                    · {formatDateTime(e.occurred_at)}
                                                </span>
                                            </span>
                                            {e.changes
                                                .filter((c) => !HIDDEN_CHANGES.has(c.field))
                                                .map((c) => (
                                                    <span key={c.field} className="text-sm text-muted-foreground">
                                                        {labeler.field(c.field)?.label ?? c.field}
                                                    </span>
                                                ))}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </TabsContent>
            </Tabs>

            {template && (
                <RequestEditorDialog
                    template={template}
                    editing={editing ? (submission as IFormSubmission) : null}
                    onHide={() => setEditing(false)}
                />
            )}
        </div>
    );
}
