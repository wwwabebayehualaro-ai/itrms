import { describe, expect, it } from 'vitest';

import { fieldTexts, formTextIn, formTextSchema, missingIn, ownText, setTextIn } from './text';

describe('formTextSchema', () => {
    it('accepts a plain string and a map by language', () => {
        for (const ok of ['Name', '', { am: 'ስም', en: 'Name' }, { am: 'ስም' }, { 'wal-Latn': 'x' }])
            expect(formTextSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    });

    it('refuses a bad tag, more than 10 languages and a value that is not a string', () => {
        expect(formTextSchema.safeParse({ 'not a tag': 'x' }).success).toBe(false);
        expect(formTextSchema.safeParse({ AM: 'x' }).success).toBe(false);
        const tags = ['am', 'en', 'om', 'ti', 'so', 'aa', 'wal', 'sid', 'gaz', 'hdy', 'kcy'];
        expect(formTextSchema.safeParse(Object.fromEntries(tags.slice(0, 10).map((t) => [t, 'x']))).success).toBe(true);
        expect(formTextSchema.safeParse(Object.fromEntries(tags.map((t) => [t, 'x']))).success).toBe(false);
        for (const bad of [{ am: 1 }, { am: null }, 5, null, ['x']])
            expect(formTextSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
});

describe('formTextIn', () => {
    const both = { am: 'ስም', en: 'Name' };

    it('gives the language asked, then Amharic, then English, then any other in tag order', () => {
        expect(formTextIn(both, 'en')).toBe('Name');
        expect(formTextIn(both, 'am')).toBe('ስም');
        expect(formTextIn(both, 'wal-Latn')).toBe('ስም');
        expect(formTextIn({ en: 'Name' }, 'en')).toBe('Name');
        expect(formTextIn({ en: 'Name' }, 'am')).toBe('Name');
        expect(formTextIn({ am: 'ስም' }, 'en')).toBe('ስም');
        expect(formTextIn({ om: 'Maqaa' }, 'en')).toBe('Maqaa');
        expect(formTextIn({ ti: 'b', om: 'a' }, 'en')).toBe('a');
        expect(formTextIn({}, 'en')).toBeUndefined();
        expect(formTextIn(undefined, 'en')).toBeUndefined();
    });

    it('counts an empty text as missing', () => {
        expect(formTextIn({ am: '', en: 'Name' }, 'am')).toBe('Name');
        expect(formTextIn({ en: '', am: 'ስም' }, 'en')).toBe('ስም');
        expect(formTextIn({ am: '', en: '' }, 'en')).toBeUndefined();
    });

    it('gives a plain string in every language', () => {
        for (const language of ['am', 'en', 'wal-Latn', 'om']) expect(formTextIn('Same', language)).toBe('Same');
    });
});

describe('ownText and missingIn', () => {
    it('take a plain string as the text of the language it was written in', () => {
        expect(ownText('Name', 'en', 'en')).toBe('Name');
        expect(ownText('Name', 'am', 'en')).toBe('');
        expect(ownText({ am: 'ስም' }, 'en', 'en')).toBe('');
        expect(missingIn({ am: 'ስም' }, 'en', 'am')).toBe(true);
        expect(missingIn({ am: 'ስም' }, 'am', 'am')).toBe(false);
    });
});

describe('setTextIn', () => {
    it('keeps a plain string plain when written in its own language, and clears it with an empty one', () => {
        expect(setTextIn('Name', 'en', 'Full name', 'en')).toBe('Full name');
        expect(setTextIn('Name', 'en', '', 'en')).toBeUndefined();
        expect(setTextIn(undefined, 'am', 'ስም', 'am')).toBe('ስም');
    });

    it('turns a plain string into a map, keeping it, when written in another language', () => {
        expect(setTextIn('Name', 'am', 'ስም', 'en')).toEqual({ en: 'Name', am: 'ስም' });
        expect(setTextIn(undefined, 'am', 'ስም', 'en')).toEqual({ am: 'ስም' });
        expect(setTextIn(undefined, 'am', '', 'en')).toBeUndefined();
    });

    it('sets and removes a language of a map, drops empty entries, and never turns back into a string', () => {
        expect(setTextIn({ am: 'ስም', en: 'Name' }, 'en', 'Full', 'am')).toEqual({ am: 'ስም', en: 'Full' });
        expect(setTextIn({ am: 'ስም', en: 'Name' }, 'en', '', 'am')).toEqual({ am: 'ስም' });
        expect(setTextIn({ am: 'ስም', en: '' }, 'am', 'ስሙ', 'am')).toEqual({ am: 'ስሙ' });
        expect(setTextIn({ am: 'ስም' }, 'am', '', 'am')).toBeUndefined();
    });
});

describe('fieldTexts', () => {
    it('lists the label, props or inherited help text and placeholder, options and messages with their paths', () => {
        const texts = fieldTexts({
            label: 'L',
            props: { helpText: 'H' },
            data: { defaultProps: { helpText: 'inherited', placeholder: 'P' } },
            behavior: {
                validation: {
                    errorMessages: { required: 'R' },
                    rules: { patternMessage: 'PM' },
                    remote: { message: 'RM' }
                }
            }
        });
        expect(texts.map((t) => [t.path, t.kind, t.ref, t.value])).toEqual([
            ['label', 'label', undefined, 'L'],
            ['props.helpText', 'helpText', undefined, 'H'],
            ['props.placeholder', 'placeholder', undefined, 'P'],
            ['behavior.validation.errorMessages.required', 'message', 'required', 'R'],
            ['behavior.validation.rules.patternMessage', 'message', 'pattern', 'PM'],
            ['behavior.validation.remote.message', 'message', 'remote', 'RM']
        ]);
    });

    it('lists the message of each validWhen rule that has one, numbered from 1', () => {
        const texts = fieldTexts({
            label: 'L',
            behavior: {
                validation: {
                    validWhen: [
                        { expression: 'a' },
                        { expression: 'b', message: { am: 'ሀ' } },
                        { expression: 'c', message: 'C' }
                    ]
                }
            }
        });
        expect(texts.filter((t) => t.kind === 'message').map((t) => [t.path, t.ref, t.value])).toEqual([
            ['behavior.validation.validWhen.1.message', 'validWhen.2', { am: 'ሀ' }],
            ['behavior.validation.validWhen.2.message', 'validWhen.3', 'C']
        ]);
    });

    it('takes the options from staticData, then props.options, then data.defaultProps.options', () => {
        const label = (v: string) => ({ label: v, value: v });
        const paths = (field: object) => fieldTexts(field).map((t) => t.path);
        expect(
            paths({
                data: { dataSource: { staticData: [label('a')] }, defaultProps: { options: [label('c')] } },
                props: { options: [label('b')] }
            })
        ).toEqual(['label', 'data.dataSource.staticData.0.label']);
        expect(paths({ props: { options: [label('b')] }, data: { defaultProps: { options: [label('c')] } } })).toEqual([
            'label',
            'props.options.0.label'
        ]);
        expect(paths({ data: { defaultProps: { options: [label('c')] } } })).toEqual([
            'label',
            'data.defaultProps.options.0.label'
        ]);
    });

    it('skips primitive options and walks nested items with a dotted number', () => {
        const texts = fieldTexts({
            props: {
                options: [
                    'plain',
                    7,
                    {
                        label: 'Group',
                        value: 'g',
                        items: [
                            { label: { am: 'ሀ' }, value: 'a' },
                            { label: 'B', value: 'b' }
                        ]
                    }
                ]
            }
        });
        expect(texts.filter((t) => t.kind === 'option').map((t) => [t.path, t.ref])).toEqual([
            ['props.options.2.label', '3'],
            ['props.options.2.items.0.label', '3.1'],
            ['props.options.2.items.1.label', '3.2']
        ]);
        expect(fieldTexts(null)).toEqual([]);
    });
});
