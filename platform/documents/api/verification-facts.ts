/**
 * What a document says of itself for verification (task 0.23b): whose it is and until when, by the shape of its data. The
 * public page and the QR show a masked name, never the name.
 */
import type { DocumentDataSchema } from '../contracts';

export interface VerificationFacts {
    holder: string | null;
    validUntil: string | null;
}

export function factsOf(schema: DocumentDataSchema, data: Record<string, unknown>): VerificationFacts {
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
    switch (schema) {
        case 'receipt.v1':
            return { holder: text(data.receivedFrom), validUntil: null };
        case 'licence-card.v1':
            return { holder: text(data.holderName), validUntil: text(data.validUntil) };
        case 'vehicle-libre.v1': {
            const owners = Array.isArray(data.owners) ? data.owners : [];
            const names = owners
                .map((o) => text((o as { name?: unknown } | null)?.name))
                .filter((n): n is string => n !== null);
            return { holder: names.length ? names.join(', ') : null, validUntil: null };
        }
        case 'application-copy.v1':
        case 'exam-result.v1':
            return { holder: null, validUntil: null };
    }
}

/**
 * "Abebe Kebede" is "A**** K*****": enough to tell a wrong document, not enough to learn a name. Several holders (a libre's
 * owners, joined with commas) are masked one by one and stay apart.
 */
export const maskedName = (name: string): string =>
    name
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '')
        .map((one) =>
            one
                .split(/\s+/)
                .map((word) => {
                    const letters = [...word];
                    return `${letters[0] ?? ''}${'*'.repeat(Math.max(letters.length - 1, 1))}`;
                })
                .join(' ')
        )
        .join(', ');
