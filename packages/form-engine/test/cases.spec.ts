// @vitest-environment node
// The shared validation cases (cases.json) as the browser runs them; the API runs the same file over HTTP
// (apps/api/test/integration/forms.int.spec.ts), so a case that passes here and fails there is a parity bug.
import { describe, expect, it } from 'vitest';

import { readDocument, submittedValues, validateForm } from '../src/core';
import cases from './cases.json' with { type: 'json' };

describe('shared validation cases', () => {
    it.each(cases.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
        const { fields, invalid } = readDocument({ fields: c.fields });
        expect(invalid).toEqual([]);
        const stored = submittedValues(fields, c.values);
        expect(stored).toEqual(c.stored);
        expect(validateForm(fields, stored, {}, { language: cases.language })).toEqual(c.errors);
    });
});
