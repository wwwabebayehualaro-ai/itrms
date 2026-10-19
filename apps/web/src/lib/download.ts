// saveBlob is a browser helper of the design system; this module adds the HTTP side.
export { saveBlob } from '@itrms/ui';

/** Extracts `filename` from a Content-Disposition header. */
export function filenameFromDisposition(header: string | undefined, fallback: string) {
    return header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallback;
}
