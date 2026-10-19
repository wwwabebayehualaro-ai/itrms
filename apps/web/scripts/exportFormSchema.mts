// Writes the form_config contract (JSON Schema, from the engine's Zod schemas and the field kit's types) to
// contracts/form-config.schema.json. The backend validates every saved form against it.
//
//   npm run form:schema           write the file
//   npm run form:schema -- --check   fail when the committed file is out of date (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

await import('@/form-engine/renderer/fields/registerAll');
const { registeredTypes } = await import('@/form-engine/renderer/kit');
const { formConfigJsonSchema } = await import('@/form-engine/core/contract');

const path = fileURLToPath(new URL('../../../contracts/form-config.schema.json', import.meta.url));
const text = formConfigJsonSchema(registeredTypes());
let current = '';
try {
    current = readFileSync(path, 'utf8');
} catch {
    /* new file */
}
if (process.argv.includes('--check')) {
    if (current !== text) {
        console.error('contracts/form-config.schema.json is out of date: run `pnpm --filter @itrms/web form:schema`');
        process.exit(1);
    }
    console.log('form_config contract is current');
} else {
    writeFileSync(path, text);
    console.log(current === text ? 'form_config contract unchanged' : `wrote ${path}`);
}
