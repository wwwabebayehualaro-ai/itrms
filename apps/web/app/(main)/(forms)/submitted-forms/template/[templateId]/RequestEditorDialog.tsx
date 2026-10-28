'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@itrms/ui';
import { PublishedFormRenderer, useSubmissionMutations } from '@itrms/form-engine/renderer';

import { DraftedForm } from '@/form-templates/DraftedForm';
import type { DraftStart } from '@/lib/drafts';

type Template = Parameters<typeof PublishedFormRenderer>[0]['template'];

interface Props {
    template: NonNullable<Template>;
    /** 'new' for a blank form, a draft to go on with (task 0.20c), a request to edit it, null to close. */
    editing: 'new' | { resume: DraftStart } | IFormSubmission | null;
    onHide: () => void;
    onSaved?: (saved: IFormSubmission) => void;
}

/** New request / Edit request in a dialog, for any form. Used by the list of requests and by the record page. */
export function RequestEditorDialog({ template, editing, onHide, onSaved }: Props) {
    const { create, update } = useSubmissionMutations(); // they also refresh every view showing these requests
    const resume = editing && editing !== 'new' && 'resume' in editing ? (editing.resume as DraftStart) : null;
    const existing = editing && editing !== 'new' && !resume ? (editing as IFormSubmission) : null;
    // the form hands over a ready-made submission payload (template id, values, metadata)
    const save = async (payload: IFormSubmissionBase) => {
        const saved = existing
            ? await update.mutateAsync({ id: existing.id as string, data: payload })
            : await create.mutateAsync(payload);
        onHide();
        onSaved?.(saved);
        return saved;
    };
    return (
        <Dialog open={!!editing} onOpenChange={(o) => !o && onHide()}>
            <DialogContent
                className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
                // what was typed is not lost to a stray key or click: the dialog closes with its ✕ or after saving
                onEscapeKeyDown={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                data-request-editor
            >
                <DialogHeader>
                    <DialogTitle>{existing ? 'Edit request' : 'New request'}</DialogTitle>
                    <DialogDescription>{template.name}</DialogDescription>
                </DialogHeader>
                {editing && !existing && (
                    // a new request is kept as a draft while it is filled in (task 0.20c)
                    <DraftedForm
                        key={resume ? 'resume' : 'new'}
                        template={template}
                        start={resume ?? undefined}
                        submitLabel="Submit request"
                        onFormSubmit={save}
                    />
                )}
                {existing && (
                    // requests are filled in (and edited) on the published version of the form, as the server records them
                    <PublishedFormRenderer
                        key={existing ? (existing.id as string) : 'new'}
                        bare
                        template={template}
                        submissionId={existing ? (existing.id as string) : null}
                        initialValues={existing ? existing.submission_data : {}}
                        submitLabel={existing ? 'Save changes' : 'Submit request'}
                        onFormSubmit={save}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
