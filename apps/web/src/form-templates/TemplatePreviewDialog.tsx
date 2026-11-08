'use client';

import { FileQuestion } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, FileViewer, Spinner } from '@itrms/ui';
import { useAttachmentPreview } from '@itrms/form-engine/renderer';
import { useText } from '@/lib/preferences';
import type { IFormTemplate } from '@/types/template_builder/form';

/** The file attached to a form (thumbnail, PDF), fetched only while the dialog is open and cached per file id. */
export default function TemplatePreviewDialog({
    template,
    onHide
}: {
    template: IFormTemplate | null;
    onHide: () => void;
}) {
    const { t } = useText();
    const file = (template?.file_relations as Array<{ file_id?: string; content_type?: string }> | undefined)?.[0];
    const { preview } = useAttachmentPreview(template ? file?.file_id : undefined);
    return (
        <Dialog open={!!template} onOpenChange={(o) => !o && onHide()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{template?.name || t('shell.templates.attachment.title')}</DialogTitle>
                </DialogHeader>
                {preview.loading ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                        <Spinner /> {t('shell.templates.attachment.loading')}
                    </div>
                ) : preview.base64 && file?.file_id ? (
                    <FileViewer
                        file={preview.base64}
                        identifier={template?.name || 'file'}
                        contentType={preview.contentType}
                        labels={{
                            empty: t('shell.files.empty'),
                            download: t('shell.files.download'),
                            cannotShow: t('shell.files.cannotShow'),
                            pdf: {
                                toolbar: t('shell.files.pdf.toolbar'),
                                previous: t('shell.files.pdf.previous'),
                                next: t('shell.files.pdf.next'),
                                zoomIn: t('shell.files.pdf.zoomIn'),
                                zoomOut: t('shell.files.pdf.zoomOut'),
                                loading: t('shell.files.pdf.loading'),
                                error: t('shell.files.pdf.error')
                            }
                        }}
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                        <FileQuestion className="size-8" />
                        {template?.file_relations?.length
                            ? t('shell.templates.attachment.cannotShow')
                            : t('shell.templates.attachment.none')}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
