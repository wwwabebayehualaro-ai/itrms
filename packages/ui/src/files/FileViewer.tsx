'use client';

import { Download, FileQuestion } from 'lucide-react';
import { Button } from '../primitives/button';
import { saveBlob } from '../lib/download';
import PdfViewer from './PdfViewer';

/** Bytes of raw (or URL-safe) base64; empty when it cannot be read. */
function bytesOf(base64: string): Uint8Array {
    let s = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return new Uint8Array();
    }
}

const sniff = (b: Uint8Array): { type: string; ext: string } | null => {
    const starts = (sig: number[]) => sig.every((x, i) => b[i] === x);
    if (starts([0x25, 0x50, 0x44, 0x46])) return { type: 'application/pdf', ext: 'pdf' };
    if (starts([0x89, 0x50, 0x4e, 0x47])) return { type: 'image/png', ext: 'png' };
    if (starts([0xff, 0xd8, 0xff])) return { type: 'image/jpeg', ext: 'jpg' };
    if (starts([0x47, 0x49, 0x46])) return { type: 'image/gif', ext: 'gif' };
    if (starts([0x52, 0x49, 0x46, 0x46]) && b[8] === 0x57) return { type: 'image/webp', ext: 'webp' };
    return null;
};

/** A stored file shown in place: PDFs in a viewer, images as images, anything else as a download. */
export default function FileViewer({
    file,
    identifier,
    contentType
}: {
    file?: string | null;
    identifier: string;
    contentType?: string;
}) {
    const bytes = file ? bytesOf(file) : new Uint8Array();
    const kind = sniff(bytes) ?? (contentType ? { type: contentType, ext: contentType.split('/')[1] ?? 'bin' } : null);
    const download = () =>
        saveBlob(
            new Blob([bytes as BlobPart], { type: kind?.type ?? 'application/octet-stream' }),
            `${identifier || 'file'}.${kind?.ext ?? 'bin'}`
        );
    if (!file || !bytes.length)
        return (
            <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
                <FileQuestion className="size-8" />
                No file to show
            </div>
        );
    return (
        <div className="flex w-full flex-col gap-3" data-file-viewer>
            <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={download}>
                    <Download />
                    Download
                </Button>
            </div>
            {kind?.type === 'application/pdf' ? (
                <div className="h-[70vh] overflow-hidden rounded-md border">
                    <PdfViewer base64={file} />
                </div>
            ) : kind?.type.startsWith('image/') ? (
                <img
                    src={`data:${kind.type};base64,${file}`}
                    alt={identifier}
                    className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
                />
            ) : (
                <p className="text-center text-sm text-muted-foreground">
                    This file cannot be shown here. Download it to open it.
                </p>
            )}
        </div>
    );
}
