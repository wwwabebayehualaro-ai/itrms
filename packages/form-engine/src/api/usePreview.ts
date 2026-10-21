import { useFilePreview } from '../host/files';

/** Attachment preview for a stored file, cached per file id (see `useFilePreview`). */
export const usePreview = (fileId?: string | null) => {
    const q = useFilePreview(fileId);
    return {
        preview: {
            base64: q.data?.base64,
            contentType: q.data?.contentType,
            loading: q.isPending && !!fileId,
            error: q.error ?? undefined
        },
        refetch: q.refetch
    };
};
