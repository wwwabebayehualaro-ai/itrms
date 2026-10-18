import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import '@platform/form-engine/renderer/fields/registerAll';
import { registeredTypes } from '@platform/form-engine/renderer/kit';
import { formConfigJsonSchema } from '@platform/form-engine/core/contract';

describe('form_config contract', () => {
    it('is current: contracts/form-config.schema.json matches the engine (run `npm run form:schema` after changing field types)', () => {
        const committed = readFileSync(resolve(process.cwd(), '../contracts/form-config.schema.json'), 'utf8') // vitest runs from Frontend/;
        expect(committed).toBe(formConfigJsonSchema(registeredTypes()));
    });
});
