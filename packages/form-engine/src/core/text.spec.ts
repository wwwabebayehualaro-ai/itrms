// @vitest-environment node
// Task 0.17a: a form's texts in every language, resolved where the form is read.
import { describe, expect, it } from 'vitest';

import { checkDocument, readDocument, untranslatedInDocument, untranslatedTexts, validateForm } from './';

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

describe('the texts of containers, rows and bindings (task 0.17c)', () => {
    const t = (am: string, en?: string) => (en === undefined ? { am } : { am, en });
    const fields = [
        { id: 'p', type: 'Panel', label: 'P', props: { header: t('ራስ', 'Head') } },
        { id: 'fs', type: 'Fieldset', label: 'F', props: { legend: t('መግለጫ', 'Legend') } },
        { id: 'arr', type: 'FormArray', label: 'A', props: { addButtonLabel: t('ጨምር', 'Add'), emptyMessage: t('ባዶ') } },
        { id: 'up', type: 'FileUpload', label: 'U', props: { chooseLabel: t('ምረጥ', 'Choose') } },
        {
            id: 'tbl',
            type: 'DataTable',
            label: 'T',
            props: {
                columns: [
                    { field: 'x', header: t('አምድ', 'Column') },
                    { field: 'y', header: 'Plain' }
                ]
            },
            data: { rowsBinding: { dataSourceId: 'd', emptyMessage: t('ምንም', 'Nothing') } }
        },
        {
            id: 'dd',
            type: 'Dropdown',
            label: 'D',
            props: {},
            data: { optionsBinding: { dataSourceId: 'd', emptyMessage: t('የለም', 'None') } }
        }
    ];
    const read = (language: string) => readDocument({ fields }, { language }).fields;
    const get = (language: string, id: string) => {
        const f = read(language).find((x) => x.id === id);
        if (!f) throw new Error(id);
        return f;
    };

    it('resolves each in the language asked, with the fallback', () => {
        expect(get('am', 'p').props.header).toBe('ራስ');
        expect(get('en', 'p').props.header).toBe('Head');
        expect(get('en', 'fs').props.legend).toBe('Legend');
        expect(get('en', 'arr').props.addButtonLabel).toBe('Add');
        expect(get('en', 'arr').props.emptyMessage).toBe('ባዶ');
        expect(get('en', 'up').props.chooseLabel).toBe('Choose');
        expect(get('am', 'up').props.chooseLabel).toBe('ምረጥ');
        const columns = (l: string) => (get(l, 'tbl').props.columns as { header: string }[]).map((c) => c.header);
        expect(columns('en')).toEqual(['Column', 'Plain']);
        expect(columns('am')).toEqual(['አምድ', 'Plain']);
        expect(get('en', 'tbl').rowsBinding?.emptyMessage).toBe('Nothing');
        expect(get('am', 'tbl').rowsBinding?.emptyMessage).toBe('ምንም');
        expect(get('en', 'dd').optionsBinding?.emptyMessage).toBe('None');
        expect(get('am', 'dd').optionsBinding?.dataSourceId).toBe('d');
    });

    it('counts them as untranslated, without any page language', () => {
        const missing = untranslatedTexts(fields, 'am')
            .filter((m) => m.kind !== 'label')
            .map((m) => [m.fieldId, m.path, m.missing]);
        expect(missing).toEqual([
            ['arr', 'props.emptyMessage', ['en']],
            ['tbl', 'props.columns.1.header', ['en']]
        ]);
        const notLabels = (doc: unknown) => untranslatedInDocument(doc).filter((m) => m.kind !== 'label').length;
        expect(notLabels({ fields })).toBe(2);
        // plain strings are the document's own language
        expect(notLabels({ fields, textLanguage: 'en' })).toBe(2);
        expect(
            untranslatedInDocument({ fields, textLanguage: 'en' }).find((m) => m.path === 'props.columns.1.header')
                ?.missing
        ).toEqual(['am']);
        expect(readDocument({ fields, textLanguage: 'en' }).textLanguage).toBe('en');
        expect(readDocument({ fields }).textLanguage).toBe('am');
    });
});
