// The starter blocks (task 1.13d) are documents the engine takes as they are: no structural problem, no lint error, keys
// unique across the blocks (so a form that copies several of them needs no prefix).
import { checkDocument, lintDocument } from '@itrms/form-engine/core';
import { describe, expect, it } from 'vitest';

import { STARTER_BLOCKS } from '../seed';

describe('the starter blocks', () => {
    it('are the six the form platform names, with Amharic and English names', () => {
        expect(STARTER_BLOCKS.map((b) => b.key)).toEqual([
            'block-applicant',
            'block-vehicle',
            'block-payment',
            'block-attachments',
            'block-officer-remarks',
            'block-approval-signoff'
        ]);
        for (const b of STARTER_BLOCKS) expect(b.name.am && b.name.en).toBeTruthy();
    });

    it.each(STARTER_BLOCKS.map((b) => [b.key, b] as const))('%s is a document the engine takes', (_, block) => {
        const document = { schemaVersion: 2, fields: block.fields };
        expect(checkDocument(document)).toEqual([]);
        expect(lintDocument(document).filter((p) => p.severity === 'error')).toEqual([]);
    });

    it('use each key once across all of them', () => {
        const keys = STARTER_BLOCKS.flatMap((b) => b.fields.map((f) => (f as { id: string }).id));
        expect(new Set(keys).size).toBe(keys.length);
    });
});
