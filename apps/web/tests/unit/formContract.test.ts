import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import '@/form-engine/renderer/fields/registerAll';
import { registeredTypes } from '@/form-engine/renderer/kit';
import { formConfigJsonSchema } from '@/form-engine/core/contract';

describe('form_config contract', () => {
    it('is current: contracts/form-config.schema.json matches the engine (run `pnpm --filter @itrms/web form:schema` after changing field types)', () => {
        const committed = readFileSync(resolve(process.cwd(), '../../contracts/form-config.schema.json'), 'utf8'); // vitest runs from apps/web
        // A Windows checkout may hold CRLF; the repository stores LF (.gitattributes).
        expect(committed.replace(/\r\n/g, '\n')).toBe(formConfigJsonSchema(registeredTypes()));
    });
});
