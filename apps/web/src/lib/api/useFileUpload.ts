'use client';

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from './client';
import { createKeys } from '../query/keys';
import { convertBlobToBase64 } from '../fileUtils';
import { filenameFromDisposition, saveBlob } from '../download';

const BASE = 'files/upload';

export const fileKeys = createKeys('files');

export interface FilePreview {
    blob: Blob;
    base64: string;
    contentType: string;
}

/** A stored file never changes (new content gets a new id), so its preview is cached for the session and kept warm for reuse. */
export const filePreviewOptions = (fileId: string) =>
    queryOptions({
        queryKey: [...fileKeys.detail(fileId), 'preview'] as const,
        queryFn: async ({ signal }): Promise<FilePreview> => {
            const res = await client.get<Blob>(`${BASE}/${fileId}/preview`, { responseType: 'blob', signal });
            return {
                blob: res.data,
                base64: await convertBlobToBase64(res.data),
                contentType: String(res.headers['content-type'] ?? 'application/octet-stream')
            };
        },
        staleTime: Infinity,
        gcTime: 10 * 60_000
    });

/** Preview of an uploaded file (base64 + content type). Pass `undefined` while the id is not known yet. */
export function useFilePreview(fileId?: string | null) {
    return useQuery({ ...filePreviewOptions(fileId ?? ''), enabled: !!fileId });
}

type Progress = (percentage: number) => void;
const progressHandler = (onProgress?: Progress) =>
    onProgress
        ? {
              onUploadProgress: (e: { loaded: number; total?: number }) =>
                  e.total && onProgress(Math.round((e.loaded * 100) / e.total))
          }
        : {};

export const useFileUpload = () => {
    const qc = useQueryClient();

    const uploadFile = useMutation({
        mutationFn: async ({ file, onProgress }: { file: File; onProgress?: Progress }) => {
            const form = new FormData();
            form.append('file', file);
            return (await client.post<IFileUploadResponse>(BASE, form, progressHandler(onProgress))).data;
        },
        meta: { errorMessage: 'File upload failed' }
    });

    const batchUploadFiles = useMutation({
        mutationFn: async ({ files, onProgress }: { files: File[]; onProgress?: Progress }) => {
            const form = new FormData();
            files.forEach((f) => form.append('files', f));
            return (await client.post<IBatchFileUploadResponse>(`${BASE}/batch`, form, progressHandler(onProgress)))
                .data;
        },
        meta: { errorMessage: 'File upload failed' }
    });

    const downloadFile = useMutation({
        mutationFn: async (fileId: string) => {
            const res = await client.get<Blob>(`${BASE}/${fileId}/download`, { responseType: 'blob' });
            saveBlob(new Blob([res.data]), filenameFromDisposition(res.headers['content-disposition'], fileId));
            return true;
        },
        meta: { errorMessage: 'Download failed' }
    });

    const deleteFile = useMutation({
        mutationFn: async (fileId: string) => {
            await client.delete(`${BASE}/${fileId}`);
            return fileId;
        },
        onSuccess: (fileId) => qc.removeQueries({ queryKey: fileKeys.detail(fileId) }),
        meta: { errorMessage: 'Could not delete file' }
    });

    const all = [uploadFile, batchUploadFiles, downloadFile, deleteFile];
    return {
        uploadFile: uploadFile.mutateAsync,
        batchUploadFiles: batchUploadFiles.mutateAsync,
        downloadFile: downloadFile.mutateAsync,
        deleteFile: deleteFile.mutateAsync,
        /** Imperative preview through the shared cache (same entry `useFilePreview` uses). */
        previewFile: (fileId: string) => qc.fetchQuery(filePreviewOptions(fileId)),
        loading: all.some((m) => m.isPending),
        error: all.find((m) => m.error)?.error ?? null,
        resetError: () => all.forEach((m) => m.reset())
    };
};
