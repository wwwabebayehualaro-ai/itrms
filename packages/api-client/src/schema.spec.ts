import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { generateTypes, TYPES } from '../generate.mjs';

describe('the generated types', () => {
    it('match openapi.json (run `pnpm openapi` after changing the API)', async () => {
        expect(readFileSync(TYPES, 'utf8')).toBe(await generateTypes());
    });
});
