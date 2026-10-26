import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@itrms/ui';

import '../renderer/fields/registerAll';
import { FormsHostProvider } from '../host/FormsHost';
import { amText, testHost } from '../test-utils';
import { fromStored } from './document';
import { OptionsEditor } from './controls';
import { Translations } from './Translations';
import { DesignerProvider, createDesignerStore } from './store';

const field = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    props: {},
    data: { defaultProps: {} },
    layout: { options: { isContainer: false } },
    ...extra
});

const setup = (extra: Record<string, unknown>[] = [], language = 'am') => {
    const { doc } = fromStored({
        fields: [
            ...extra,
            field('name', { label: { am: 'ስም', en: 'Name' } }),
            field('city', { label: { am: 'ከተማ' }, props: { helpText: 'Where you live' } }),
            field('kind', {
                type: 'Select',
                label: { am: 'ዓይነት', en: 'Kind' },
                props: { options: [{ label: { am: 'አንድ', en: 'One' }, value: 'one' }] }
            })
        ]
    });
    const store = createDesignerStore(doc, { name: 'T', slug: 't', form_config: {} }, 'am');
    const host = testHost({ language, languages: ['am', 'en', 'wal-Latn'] });
    render(
        <FormsHostProvider host={host}>
            <TooltipProvider>
                <DesignerProvider value={store}>
                    <Translations />
                </DesignerProvider>
            </TooltipProvider>
        </FormsHostProvider>
    );
    return store;
};

/** The accessible name of a cell, in Amharic: `cell('ሳጥን', 'setting.title', 'አማርኛ')`. */
const cell = (fieldLabel: string, kind: string, language: string) =>
    amText('form-engine.designer.translations.cellLabel', { field: fieldLabel, kind, language });

const rowKeys = () => [...document.querySelectorAll('[data-text-row]')].map((r) => r.getAttribute('data-text-row'));

describe('Translations: settings and columns', () => {
    it('lists the panel title, the row buttons and a column header, and keeps the other language when editing', () => {
        const store = setup([
            field('box', { type: 'Panel', label: { am: 'ሳጥን', en: 'Box' }, props: { header: { am: 'ርዕስ' } } }),
            field('rows', {
                type: 'FormArray',
                label: { am: 'ረድፎች', en: 'Rows' },
                props: { addButtonLabel: { am: 'ጨምር', en: 'Add' }, removeButtonLabel: 'አስወግድ' }
            }),
            field('table', {
                type: 'DataTable',
                label: { am: 'ሰንጠረዥ', en: 'Table' },
                props: { columns: [{ header: { am: 'ስም' }, field: 'name' }] }
            })
        ]);
        expect(rowKeys()).toEqual(
            expect.arrayContaining(['box:props.header', 'rows:props.removeButtonLabel', 'table:props.columns.0.header'])
        );
        expect(
            screen.getByLabelText(cell('ሳጥን', amText('form-engine.designer.translations.setting.title'), 'አማርኛ'))
        ).toBeInTheDocument();
        expect(
            screen.getByLabelText(
                cell('ረድፎች', amText('form-engine.designer.translations.setting.removeRowButton'), 'English')
            )
        ).toBeInTheDocument();
        fireEvent.change(
            screen.getByLabelText(
                cell('ሰንጠረዥ', amText('form-engine.designer.translations.kind.column', { ref: '1' }), 'English')
            ),
            { target: { value: 'Name' } }
        );
        const column = (store.getState().doc.byId.table?.props.columns as Record<string, unknown>[])[0];
        expect(column?.header).toEqual({ am: 'ስም', en: 'Name' });
        expect(column?.field).toBe('name');
    });

    it('writes an add-row button in English and keeps Amharic', () => {
        const store = setup([
            field('rows', {
                type: 'FormArray',
                label: { am: 'ረድፎች', en: 'Rows' },
                props: { addButtonLabel: { am: 'ጨምር' } }
            })
        ]);
        fireEvent.change(
            screen.getByLabelText(
                cell('ረድፎች', amText('form-engine.designer.translations.setting.addRowButton'), 'English')
            ),
            { target: { value: 'Add' } }
        );
        expect(store.getState().doc.byId.rows?.props.addButtonLabel).toEqual({ am: 'ጨምር', en: 'Add' });
    });
});

describe('Translations', () => {
    it('lists the untranslated texts: Missing in am/en, Not translated in an optional language', () => {
        setup();
        // city: the label has no English; the help text is a plain string (Amharic's), so English is missing too
        expect(rowKeys()).toEqual(['city:label', 'city:props.helpText']);
        const label = document.querySelector('[data-text-row="city:label"]') as HTMLElement;
        expect(within(label).getAllByText(amText('form-engine.designer.translations.missing'))).toHaveLength(1);
        expect(within(label).getAllByText(amText('form-engine.designer.translations.notTranslated'))).toHaveLength(1);
        expect(screen.getByText('Wolayttatto')).toBeInTheDocument();
        expect(
            screen.getByText(amText('form-engine.designer.translations.toTranslate', { count: '2' }))
        ).toBeInTheDocument();
    });

    it('writes the English cell into the document, drops the count, and undoes', () => {
        const store = setup();
        fireEvent.change(
            screen.getByLabelText(cell('ከተማ', amText('form-engine.designer.translations.kind.label'), 'English')),
            { target: { value: 'City' } }
        );
        expect(store.getState().doc.byId.city?.label).toEqual({ am: 'ከተማ', en: 'City' });
        // the row stays while the person types in it
        expect(rowKeys()).toContain('city:label');
        expect(
            screen.getByText(amText('form-engine.designer.translations.toTranslate', { count: '1' }))
        ).toBeInTheDocument();
        fireEvent.change(
            screen.getByLabelText(cell('ከተማ', amText('form-engine.designer.translations.kind.helpText'), 'English')),
            { target: { value: 'Town' } }
        );
        expect(store.getState().doc.byId.city?.props.helpText).toEqual({ am: 'Where you live', en: 'Town' });
        expect(screen.getByText(amText('form-engine.designer.translations.allTranslated'))).toBeInTheDocument();
        store.getState().actions.undo();
        expect(store.getState().doc.byId.city?.props.helpText).toBe('Where you live');
    });

    it('filters: all texts with the switch off, and by search', () => {
        setup();
        fireEvent.click(
            screen.getByRole('switch', { name: amText('form-engine.designer.translations.onlyUntranslated') })
        );
        expect(rowKeys()).toHaveLength(5); // 3 labels, the help text, the option
        fireEvent.change(screen.getByLabelText(amText('form-engine.designer.translations.searchLabel')), {
            target: { value: 'kind' }
        });
        expect(rowKeys()).toEqual(['kind:label', 'kind:props.options.0.label']);
    });
});

describe('Translations in English', () => {
    it('says the table words in the host language', () => {
        setup([], 'en');
        expect(screen.getByLabelText('Search the texts')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Only untranslated' })).toBeInTheDocument();
        expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
    });
});

const renderEditor = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('OptionsEditor', () => {
    it('keeps the other languages, disabled, other keys and the value of an option when it is translated', () => {
        const seen: unknown[] = [];
        renderEditor(
            <OptionsEditor
                language="en"
                plainAs="am"
                value={[{ label: { am: 'አንድ', en: 'One' }, value: 'one', disabled: true, items: [] }]}
                onChange={(rows) => seen.push(rows)}
            />
        );
        fireEvent.change(screen.getByLabelText(amText('form-engine.settings.controls.options.label', { n: '1' })), {
            target: { value: 'Single' }
        });
        // a translation never changes what answers store (published answers keep matching)
        expect(seen[0]).toEqual([{ label: { am: 'አንድ', en: 'Single' }, value: 'one', disabled: true, items: [] }]);
    });

    it('never makes a value from an Ethiopic label', () => {
        const seen: unknown[] = [];
        renderEditor(
            <OptionsEditor language="am" value={[{ label: '', value: '' }]} onChange={(rows) => seen.push(rows)} />
        );
        fireEvent.change(screen.getByLabelText(amText('form-engine.settings.controls.options.label', { n: '1' })), {
            target: { value: 'አንድ' }
        });
        expect(seen[0]).toEqual([{ label: 'አንድ', value: 'option_1' }]);
    });
});
