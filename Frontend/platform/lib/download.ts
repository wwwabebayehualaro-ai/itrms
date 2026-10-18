/** Triggers a browser download for a Blob (export files, file downloads). */
export function saveBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

/** Extracts `filename` from a Content-Disposition header. */
export function filenameFromDisposition(header: string | undefined, fallback: string) {
    return header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallback;
}
