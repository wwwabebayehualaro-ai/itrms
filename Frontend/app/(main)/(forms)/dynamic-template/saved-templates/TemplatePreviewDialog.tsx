'use client';

import { FileQuestion } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, FileViewer, Spinner } from '@platform/ui';
import { useAttachmentPreview } from '@platform/form-engine';
import type { IFormTemplate } from '@/types/template_builder/form';

/** The file attached to a form (thumbnail, PDF), fetched only while the dialog is open and cached per file id. */
export default function TemplatePreviewDialog({ template, onHide }: { template: IFormTemplate | null; onHide: () => void }) {
    const file = (template?.file_relations as Array<{ file_id?: string; content_type?: string }> | undefined)?.[0];
    const { preview } = useAttachmentPreview(template ? file?.file_id : undefined);
    return (
        <Dialog open={!!template} onOpenChange={(o) => !o && onHide()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{template?.name || 'Attachment'}</DialogTitle>
                </DialogHeader>
                {preview.loading ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                        <Spinner /> Loading the file…
                    </div>
                ) : preview.base64 && file?.file_id ? (
                    <FileViewer file={preview.base64} identifier={template?.name || 'file'} contentType={preview.contentType} />
                ) : (
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                        <FileQuestion className="size-8" />
                        {template?.file_relations?.length ? 'This file cannot be shown.' : 'No file attached.'}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
