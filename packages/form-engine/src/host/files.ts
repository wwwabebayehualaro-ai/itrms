'use client';

/**
 * Uploaded files, as attachment fields use them (task 0.15, architecture §14): upload, download and a cached preview.
 * The bytes never pass through the API: the API gives a presigned POST (or one URL per part of a large file) for exactly
 * the declared size and type, the browser sends the file there, then asks the API to confirm it (size, type and SHA-256
 * are checked). A download is a short presigned URL. Same query keys as the app's own file hooks
 * (`['files', 'detail', id, 'preview']`), so both share one cache entry.
 */
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import type { UploadedFile } from '@itrms/schemas';
import { saveBlob } from '@itrms/ui';

import { createKeys, type FormsClient } from './client';
import { useFormsClient } from './FormsHost';

const BASE = 'v1/files';

/** What `POST /api/v1/files` answers (@itrms/kernel contracts: uploadTicketSchema). */
interface UploadTicket {
    file: { id: string };
    upload:
        | { kind: 'post'; url: string; fields: Record<string, string> }
        | { kind: 'parts'; parts: { partNumber: number; size: number; url: string }[] };
}

interface StoredFile {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    documentType: string | null;
}

/** The SHA-256 of the file, hex: the API checks the stored object against it. */
async function sha256Of(file: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sends the bytes where the ticket says; the ETag of each part, for the confirmation. */
async function send(ticket: UploadTicket, file: File): Promise<{ partNumber: number; etag: string }[] | undefined> {
    if (ticket.upload.kind === 'post') {
        const form = new FormData();
        for (const [k, v] of Object.entries(ticket.upload.fields)) form.append(k, v);
        form.append('file', file);
        const res = await fetch(ticket.upload.url, { method: 'POST', body: form });
        if (!res.ok) throw new Error('The file could not be uploaded');
        return undefined;
    }
    const parts: { partNumber: number; etag: string }[] = [];
    let offset = 0;
    for (const part of ticket.upload.parts) {
        const res = await fetch(part.url, { method: 'PUT', body: file.slice(offset, offset + part.size) });
        if (!res.ok) throw new Error('The file could not be uploaded');
        parts.push({ partNumber: part.partNumber, etag: res.headers.get('etag') ?? '' });
        offset += part.size;
    }
    return parts;
}

const uploaded = (file: StoredFile): UploadedFile => ({
    file_id: file.id,
    url: `/api/${BASE}/${file.id}/download`,
    filename: file.filename,
    content_type: file.contentType,
    size: file.size,
    metadata: file.documentType ? { documentType: file.documentType } : undefined
});

/** A short download URL (on the app's origin) for a file the person may see. */
const downloadUrl = async (client: FormsClient, fileId: string, signal?: AbortSignal) =>
    (await client.get<{ url: string }>(`${BASE}/${fileId}/download`, { signal })).data.url;

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

/** Extracts the file name from a Content-Disposition header: the UTF-8 `filename*` first (Ethiopic names), then `filename`. */
export function filenameFromDisposition(header: string | undefined, fallback: string) {
    const extended = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (extended) {
        try {
            return decodeURIComponent(extended);
        } catch {
            // a malformed encoding: fall back to the plain name
        }
    }
    return header?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

/** A stored file never changes (new content gets a new id), so its preview is cached for the session. */
export const filePreviewOptions = (client: FormsClient, fileId: string) =>
    queryOptions({
        queryKey: [...fileKeys.detail(fileId), 'preview'] as const,
        queryFn: async ({ signal }): Promise<FilePreview> => {
            const res = await fetch(await downloadUrl(client, fileId, signal), { signal });
            if (!res.ok) throw new Error('The file could not be loaded');
            const blob = await res.blob();
            return {
                blob,
                base64: await toBase64(blob),
                contentType: res.headers.get('content-type') ?? 'application/octet-stream'
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
        mutationFn: async ({ file, documentType }: { file: File; documentType?: string }) => {
            const ticket = (
                await client.post<UploadTicket>(BASE, {
                    filename: file.name,
                    contentType: file.type,
                    size: file.size,
                    sha256: await sha256Of(file),
                    documentType
                })
            ).data;
            const parts = await send(ticket, file);
            return uploaded((await client.post<StoredFile>(`${BASE}/${ticket.file.id}/confirm`, { parts })).data);
        },
        meta: { errorMessage: 'File upload failed' }
    });
    const download = useMutation({
        mutationFn: async (fileId: string) => {
            const res = await fetch(await downloadUrl(client, fileId));
            if (!res.ok) throw new Error('Download failed');
            saveBlob(
                await res.blob(),
                filenameFromDisposition(res.headers.get('content-disposition') ?? undefined, fileId)
            );
            return true;
        },
        meta: { errorMessage: 'Download failed' }
    });
    return { uploadFile: upload.mutateAsync, downloadFile: download.mutateAsync };
}
