import { describe, expect, it } from 'vitest';

import {
    DEFAULT_ENCUMBRANCE_BLOCKS,
    ENCUMBRANCE_CONFLICTS,
    ENCUMBRANCE_KINDS,
    encumbranceBlocksSchema,
    encumbranceListQuerySchema,
    encumbranceRecordSchema,
    releaseRefusalSchema,
    releaseRequestSchema
} from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';

const record = {
    vehicleId: '0199f0a0-d000-7000-8000-000000000001',
    kind: 'bank_loan',
    holderOrganisationId: '0199f0a0-d000-7000-8000-000000000002',
    letterReference: ' LTR-1 ',
    letterDate: '2026-10-01'
};

describe('the encumbrance contracts', () => {
    it('takes a record with the holder, the letter and an optional amount in santim as text', () => {
        const parsed = encumbranceRecordSchema.parse({ ...record, amountSantim: '250000' });
        expect(parsed.letterReference).toBe('LTR-1');
        expect(encumbranceRecordSchema.safeParse({ ...record, amountSantim: '0' }).success).toBe(false);
        expect(encumbranceRecordSchema.safeParse({ ...record, amountSantim: '12.5' }).success).toBe(false);
        expect(encumbranceRecordSchema.safeParse({ ...record, kind: 'lien' }).success).toBe(false);
        expect(encumbranceRecordSchema.safeParse({ ...record, extra: 1 }).success).toBe(false);
        expect(encumbranceRecordSchema.safeParse({ ...record, letterReference: 'x'.repeat(61) }).success).toBe(false);
        expect(encumbranceRecordSchema.safeParse({ ...record, note: 'n'.repeat(501) }).success).toBe(false);
    });

    it('takes a release request with its letter, and a refusal with a reason of 10 to 500 characters', () => {
        expect(releaseRequestSchema.safeParse({ releaseReference: 'R-1', releaseDate: '2026-10-02' }).success).toBe(
            true
        );
        expect(releaseRequestSchema.safeParse({ releaseReference: 'R-1' }).success).toBe(false);
        expect(releaseRefusalSchema.safeParse({ reason: 'too short' }).success).toBe(false);
        expect(releaseRefusalSchema.safeParse({ reason: 'The letter names another vehicle.' }).success).toBe(true);
        expect(releaseRefusalSchema.safeParse({ reason: 'r'.repeat(501) }).success).toBe(false);
    });

    it('pages the list at 100 at most', () => {
        expect(encumbranceListQuerySchema.parse({}).limit).toBe(50);
        expect(encumbranceListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
        expect(encumbranceListQuerySchema.safeParse({ status: 'gone' }).success).toBe(false);
    });
});

describe('the default matrix of blocks', () => {
    it('is a valid value of its setting, and names every conflict', () => {
        expect(encumbranceBlocksSchema.safeParse(DEFAULT_ENCUMBRANCE_BLOCKS).success).toBe(true);
        expect(Object.keys(DEFAULT_ENCUMBRANCE_BLOCKS).sort()).toEqual([...ENCUMBRANCE_CONFLICTS].sort());
    });

    it('blocks a transfer with every kind and a replacement only with a bank loan or a court order', () => {
        expect(DEFAULT_ENCUMBRANCE_BLOCKS['ownership-transfer']).toEqual([...ENCUMBRANCE_KINDS]);
        expect(DEFAULT_ENCUMBRANCE_BLOCKS['zone-transfer-out']).toEqual([...ENCUMBRANCE_KINDS]);
        expect(DEFAULT_ENCUMBRANCE_BLOCKS.replacement).toEqual(['bank_loan', 'court_order']);
    });

    it('refuses a matrix with an unknown kind or a missing conflict', () => {
        expect(
            encumbranceBlocksSchema.safeParse({ ...DEFAULT_ENCUMBRANCE_BLOCKS, replacement: ['lien'] }).success
        ).toBe(false);
        expect(encumbranceBlocksSchema.safeParse({ replacement: ['bank_loan'] }).success).toBe(false);
    });
});

describe('the refusal in both languages', () => {
    const PARAMS = ['kind', 'holder', 'reference', 'office', 'more'];
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    it.each([
        ['am', am],
        ['en', en]
    ] as const)('names the kind, the holder, the letter, the office and the others in %s', (_language, words) => {
        expect(placeholders(words['vehicles.errors.encumbered'])).toEqual([...PARAMS].sort());
        expect(words['vehicles.errors.encumbered']).toContain('{holder}');
    });

    it('has a word for every kind and status in both languages', () => {
        for (const kind of ENCUMBRANCE_KINDS) {
            expect(am[`vehicles.encumbrance.kind.${kind}`]).toBeTruthy();
            expect(en[`vehicles.encumbrance.kind.${kind}`]).toBeTruthy();
        }
        for (const status of ['open', 'release_pending', 'released'] as const) {
            expect(am[`vehicles.encumbrance.status.${status}`]).toBeTruthy();
            expect(en[`vehicles.encumbrance.status.${status}`]).toBeTruthy();
        }
    });
});
