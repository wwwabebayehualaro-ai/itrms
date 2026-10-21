'use client';

/**
 * Uploaded files, as attachment fields use them: upload, download and a cached preview. Same query keys as the app's own
 * file hooks (`['files', 'detail', id, 'preview']`), so both share one cache entry.
 */
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import type { UploadedFile } from '@itrms/schemas';
import { saveBlob } from '@itrms/ui';

import { createKeys, type FormsClient } from './client';
import { useFormsClient } from './FormsHost';

const BASE = 'files/upload';

export const fileKeys = createKeys('files');

export interface FilePreview {
    blob: Blob;
    base64: string;
    contentType: string;
}

const toBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        // a data: URL, "data:<type>;base64,<data>"
        reader.onload = () => resolve(typeof reader.result === 'string' ? (reader.result.split(',')[1] ?? '') : '');
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
        reader.readAsDataURL(blob);
    });

/** Extracts `filename` from a Content-Disposition header. */
export function filenameFromDisposition(header: string | undefined, fallback: string) {
    return header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallback;
}

/** A stored file never changes (new content gets a new id), so its preview is cached for the session. */
export const filePreviewOptions = (client: FormsClient, fileId: string) =>
    queryOptions({
        queryKey: [...fileKeys.detail(fileId), 'preview'] as const,
        queryFn: async ({ signal }): Promise<FilePreview> => {
            const res = await client.get<Blob>(`${BASE}/${fileId}/preview`, { responseType: 'blob', signal });
            return {
                blob: res.data,
                base64: await toBase64(res.data),
                contentType: String(res.headers['content-type'] ?? 'application/octet-stream')
            };
        },
        staleTime: Infinity,
        gcTime: 10 * 60_000
    });

/** Preview of an uploaded file. Pass `undefined` while the id is not known yet. */
export function useFilePreview(fileId?: string | null) {
    const client = useFormsClient();
    return useQuery({ ...filePreviewOptions(client, fileId ?? ''), enabled: !!fileId });
}

export function useFileActions() {
    const client = useFormsClient();
    const upload = useMutation({
        mutationFn: async ({ file }: { file: File }) => {
            const form = new FormData();
            form.append('file', file);
            return (await client.post<UploadedFile>(BASE, form)).data;
        },
        meta: { errorMessage: 'File upload failed' }
    });
    const download = useMutation({
        mutationFn: async (fileId: string) => {
            const res = await client.get<Blob>(`${BASE}/${fileId}/download`, { responseType: 'blob' });
            saveBlob(new Blob([res.data]), filenameFromDisposition(res.headers['content-disposition'], fileId));
            return true;
        },
        meta: { errorMessage: 'Download failed' }
    });
    return { uploadFile: upload.mutateAsync, downloadFile: download.mutateAsync };
}
