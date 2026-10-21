import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, serializeOpenApi } from './openapi';

const committed = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'packages',
    'api-client',
    'openapi.json'
);

describe('the API contract', () => {
    it('is the committed packages/api-client/openapi.json (run `pnpm openapi` after changing the API)', async () => {
        expect(readFileSync(committed, 'utf8')).toBe(serializeOpenApi(await buildOpenApiDocument()));
    });

    it('describes the problem+json body', async () => {
        const document = await buildOpenApiDocument();
        expect(document.openapi).toBe('3.1.0');
        expect(document.components?.schemas?.Problem).toMatchObject({
            type: 'object',
            required: ['type', 'title', 'status', 'code']
        });
        // infrastructure endpoints are not part of the contract
        expect(Object.keys(document.paths)).not.toContain('/healthz');
    });
});
