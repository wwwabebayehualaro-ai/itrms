'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChartColumn, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataViewer, FormRenderer, ROW_ACTION_EVENT, useSubmissionMutations, useTemplateList, useTemplateQuery, type RowActionDetail, type ViewMode, type ViewRow } from '@platform/form-engine';
import { Button, IconButton, InlineStatus, confirmAction, useNotify } from '@platform/ui';
import { getApiErrorMessage } from '@platform/lib/api/errors';
import { useCan } from '@platform/lib/auth/authHooks';
import { RequestEditorDialog } from './RequestEditorDialog';

type Editor = 'new' | IFormSubmission | null;

/**
 * Requests of one form, for ANY form: the data viewer (table, cards, board, calendar, pivot, dashboard), "New request" and Edit in a dialog,
 * and a request opens as its own page (`[submissionId]`). A report someone built in the builder (`<slug>-table`) is one more view.
 */
export default function TemplateSubmissionsPage() {
    const { templateId } = useParams<{ templateId: string }>();
    const notify = useNotify();
    const canCreate = useCan('submission:create');
    const canEdit = useCan('submission:update');
    const canDelete = useCan('submission:delete');

    const { data: template, isPending: templateLoading, error: templateError } = useTemplateQuery(templateId);
    const { data: allTemplates } = useTemplateList();
    // a report someone built in the builder for this form (`<slug>-table`) stays available as one more view of the data
    const reportTemplate = useMemo(() => (template ? allTemplates?.find((t) => t.slug === `${template.slug}-table`) : undefined), [allTemplates, template]);
    const customViews = useMemo<ViewMode[]>(
        () =>
            reportTemplate
                ? [{ id: 'report', label: 'Report', icon: ChartColumn, order: 5, default: true, available: () => true, component: () => <FormRenderer view fields={reportTemplate.form_config?.fields || []} template={reportTemplate} /> }]
                : [],
        [reportTemplate]
    );

    const router = useRouter();
    const { remove } = useSubmissionMutations();
    const [editor, setEditor] = useState<Editor>(null);
    // a request is a page of its own; `from` brings the reader back to the same view (filters, mode, page)
    const open = useCallback((row: IFormSubmission) => router.push(`/submitted-forms/template/${templateId}/${row.id}${window.location.search ? `?from=${encodeURIComponent(window.location.search.slice(1))}` : ''}`), [router, templateId]);

    const confirmDelete = useCallback(
        (row: IFormSubmission) =>
            confirmAction({
                header: 'Delete this request?',
                message: 'This cannot be undone.',
                acceptLabel: 'Delete',
                rejectLabel: 'Cancel',
                danger: true,
                onAccept: async () => {
                    await remove.mutateAsync(row.id as string);
                    notify.success('Request deleted');
                    setEditor((cur) => (cur && cur !== 'new' && cur.id === row.id ? null : cur));
                }
            }),
        [remove, notify]
    );

    // View / Edit / Delete buttons of the table report back through a window event
    useEffect(() => {
        const onRowAction = (e: Event) => {
            const { action, row } = (e as CustomEvent<RowActionDetail>).detail;
            if (action === 'view') open(row);
            if (action === 'edit' && canEdit) setEditor(row);
            if (action === 'delete' && canDelete) confirmDelete(row);
        };
        window.addEventListener(ROW_ACTION_EVENT, onRowAction);
        return () => window.removeEventListener(ROW_ACTION_EVENT, onRowAction);
    }, [canEdit, canDelete, confirmDelete, open]);

    if (templateLoading) return <InlineStatus loading className="p-6" />;
    if (templateError || !template) return <InlineStatus error={getApiErrorMessage(templateError, 'This form was not found')} className="p-6" />;

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">{template.name}</h1>
                {canCreate && (
                    <span title={template.published_version_id ? undefined : 'This form is not published yet'}>
                        <Button type="button" disabled={!template.published_version_id} onClick={() => setEditor('new')}>
                            <Plus />
                            New request
                        </Button>
                    </span>
                )}
            </div>

            <RequestEditorDialog template={template} editing={editor} onHide={() => setEditor(null)} />

            <DataViewer
                templateId={templateId}
                onOpen={open}
                customViews={customViews}
                emptyMessage="No requests yet. Use “New request” to create the first one."
                rowActions={(row: ViewRow) => (
                    <>
                        {canEdit && (
                            <IconButton label="Edit" onClick={() => setEditor(row)}>
                                <Pencil />
                            </IconButton>
                        )}
                        {canDelete && (
                            <IconButton label="Delete" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(row)}>
                                <Trash2 />
                            </IconButton>
                        )}
                    </>
                )}
            />
        </div>
    );
}
