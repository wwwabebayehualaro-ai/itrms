import { createHash } from 'node:crypto';

/** What is stored of a verification token: the token itself only ever exists in the QR. */
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
