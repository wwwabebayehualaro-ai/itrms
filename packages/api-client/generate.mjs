// Generates src/schema.d.ts from openapi.json (the API's contract, written by `pnpm openapi`). The drift test
// (src/schema.spec.ts) runs the same function and compares, so CI fails when the committed types are stale.
//   pnpm --filter @itrms/api-client generate
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

export const CONTRACT = fileURLToPath(new URL('./openapi.json', import.meta.url));
export const TYPES = fileURLToPath(new URL('./src/schema.d.ts', import.meta.url));

const BANNER = '// Generated from openapi.json by `pnpm --filter @itrms/api-client generate`. Do not edit by hand.\n\n';

export async function generateTypes(document = JSON.parse(readFileSync(CONTRACT, 'utf8'))) {
    return BANNER + astToString(await openapiTS(document));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    writeFileSync(TYPES, await generateTypes());
    console.warn(`wrote ${TYPES}`);
}
