// @vitest-environment node
// Task 0.17a: a form's texts in every language, resolved where the form is read.
import { describe, expect, it } from 'vitest';

import { checkDocument, readDocument, untranslatedTexts, validateForm } from './';

const field = {
    id: 'kind',
    type: 'Dropdown',
    label: { am: 'ዓይነት', en: 'Kind' },
    props: {
        required: true,
        helpText: { am: 'እገዛ', en: 'Help' },
        options: [
            { label: { am: 'አንድ', en: 'One' }, value: 1 },
            { label: { am: 'ሁለት' }, value: 2 },
            { label: 'Three', value: 3 }
        ]
    },
    data: { defaultProps: { placeholder: { am: 'ምረጥ', en: 'Choose' } } },
    behavior: {
        validation: {
            supported: true,
            errorMessages: { required: { am: 'ያስፈልጋል', en: 'Required here' } },
            rules: { patternMessage: { en: 'Only English' } }
        }
    }
};
const doc = { fields: [field] };
const read = (language?: string) => {
    const f = readDocument(doc, language ? { language } : undefined).fields[0];
    if (!f) throw new Error('no field');
    return f;
};

describe('readDocument in a language', () => {
    it('resolves label, help text, placeholder, options and messages in Amharic by default and when asked', () => {
        for (const f of [read(), read('am')]) {
            expect(f.label).toBe('ዓይነት');
            expect(f.helpText).toBe('እገዛ');
            expect(f.props.placeholder).toBe('ምረጥ');
            expect(f.options.map((o) => o.label)).toEqual(['አንድ', 'ሁለት', 'Three']);
            expect(f.messages.required).toBe('ያስፈልጋል');
            expect(f.rules.patternMessage).toBe('Only English');
        }
    });

    it('resolves them in English, falling back to Amharic where English is missing', () => {
        const f = read('en');
        expect(f.label).toBe('Kind');
        expect(f.helpText).toBe('Help');
        expect(f.props.placeholder).toBe('Choose');
        expect(f.options.map((o) => o.label)).toEqual(['One', 'ሁለት', 'Three']);
        expect(f.messages.required).toBe('Required here');
    });

    it('falls back to Amharic for a language the form has no text in', () => {
        const f = read('wal-Latn');
        expect(f.label).toBe('ዓይነት');
        expect(f.options.map((o) => o.label)).toEqual(['አንድ', 'ሁለት', 'Three']);
        expect(f.messages.required).toBe('ያስፈልጋል');
    });
});

describe('validateForm with a message in every language', () => {
    it('answers with the message of the language the form was read in', () => {
        expect(validateForm(readDocument(doc, { language: 'am' }).fields, {})).toEqual({ kind: 'ያስፈልጋል' });
        expect(validateForm(readDocument(doc, { language: 'en' }).fields, {})).toEqual({ kind: 'Required here' });
    });
});

describe('untranslatedTexts', () => {
    it('lists the texts with nothing of their own in a required language', () => {
        const missing = untranslatedTexts([field], 'am');
        expect(missing.map((t) => [t.fieldId, t.path, t.missing])).toEqual([
            ['kind', 'props.options.1.label', ['en']],
            ['kind', 'props.options.2.label', ['en']],
            ['kind', 'behavior.validation.rules.patternMessage', ['am']]
        ]);
    });

    it('counts a plain string as the text of the authoring language only', () => {
        const plain = { id: 'a', label: 'Name' };
        expect(untranslatedTexts([plain], 'am').map((t) => t.missing)).toEqual([['en']]);
        expect(untranslatedTexts([plain], 'en').map((t) => t.missing)).toEqual([['am']]);
        expect(untranslatedTexts([plain], 'en', ['en'])).toEqual([]);
        expect(untranslatedTexts([{ id: 'b', label: '' }], 'am')).toEqual([]);
    });
});

describe('checkDocument on texts', () => {
    const problems = (fields: unknown[]) =>
        Object.fromEntries(checkDocument({ fields }).map((p) => [p.path, p.message]));

    it('accepts maps and refuses a malformed one with its path', () => {
        expect(checkDocument(doc)).toEqual([]);
        const bad = problems([{ id: 'a', type: 'InputText', props: {}, label: { am: 1 } }]);
        expect(Object.keys(bad)).toContain('fields[0].label');
        const tag = problems([{ id: 'a', type: 'InputText', props: {}, label: { 'not a tag': 'x' } }]);
        expect(Object.keys(tag)).toContain('fields[0].label');
    });
});
