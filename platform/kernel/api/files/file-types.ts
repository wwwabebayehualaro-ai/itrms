/**
 * The kinds of file ITRMS accepts (architecture §14): scans and photos of documents. A file is what its first bytes say,
 * not what its name or the browser claims: a declared type that its bytes do not show is refused.
 */
import { ACCEPTED_FILE_TYPES } from '../../contracts';

export type FileType = (typeof ACCEPTED_FILE_TYPES)[number];

export const FILE_TYPES: Readonly<Record<FileType, { extension: string; magic: readonly (readonly number[])[] }>> = {
    'application/pdf': { extension: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] },
    'image/jpeg': { extension: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
    'image/png': { extension: 'png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
    // RIFF....WEBP: bytes 8–11 are checked below
    'image/webp': { extension: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] }
};

/** How many first bytes the detection needs. */
export const MAGIC_LENGTH = 16;

const startsWith = (bytes: Uint8Array, magic: readonly number[], at = 0) => magic.every((b, i) => bytes[at + i] === b);

/** The type the first bytes show, or undefined for anything else. */
export function detectType(bytes: Uint8Array): FileType | undefined {
    for (const type of ACCEPTED_FILE_TYPES) {
        if (!FILE_TYPES[type].magic.some((m) => startsWith(bytes, m))) continue;
        if (type === 'image/webp' && !startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) continue;
        return type;
    }
    return undefined;
}
