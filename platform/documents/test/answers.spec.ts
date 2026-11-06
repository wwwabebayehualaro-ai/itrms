import { describe, expect, it } from 'vitest';

import { valueOf } from '../api/answers';

type Field = Parameters<typeof valueOf>[0];
const field = (type: string, extra: Partial<Field> = {}) =>
    ({ id: 'f', type, label: 'F', props: {}, ...extra }) as unknown as Field;
const PERSON = '0199f0a0-0000-7000-8000-000000000001';

describe('an answer on a document', () => {
    it('prints a lookup as the name the registry gives, never its id', () => {
        const labels = new Map([[PERSON, 'Generated Applicant']]);
        expect(valueOf(field('RegistryLookup'), PERSON, 'en', labels)).toBe('Generated Applicant');
        // a record the reader may not see, or gone: nothing, rather than an id
        expect(valueOf(field('RegistryLookup'), PERSON, 'en', new Map())).toBe('');
    });

    it('prints files by their names', () => {
        const files = [
            { name: 'medical.pdf', size: 81, type: 'application/pdf' },
            { name: 'kebele-id.pdf', size: 81, type: 'application/pdf' }
        ];
        expect(valueOf(field('FileUpload'), files, 'am', new Map())).toBe('medical.pdf, kebele-id.pdf');
    });

    it('keeps yes and no, options and plain values', () => {
        expect(valueOf(field('Checkbox'), true, 'en', new Map())).toBe('Yes');
        expect(
            valueOf(
                field('Select', {
                    // the fields come with their labels in the document's language
                    options: [{ value: 'B', label: 'አውቶሞቢል' }]
                }),
                'B',
                'am',
                new Map()
            )
        ).toBe('አውቶሞቢል');
        expect(valueOf(field('InputNumber'), 10, 'en', new Map())).toBe('10');
    });
});
