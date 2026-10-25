import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@itrms/ui';

import '../renderer/fields/registerAll';
import { FormsHostProvider } from '../host/FormsHost';
import { testHost } from '../test-utils';
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

const setup = () => {
    const { doc } = fromStored({
        fields: [
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
    const host = testHost({ language: 'am', languages: ['am', 'en', 'wal-Latn'] });
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

const rowKeys = () => [...document.querySelectorAll('[data-text-row]')].map((r) => r.getAttribute('data-text-row'));

describe('Translations', () => {
    it('lists the untranslated texts: Missing in am/en, Not translated in an optional language', () => {
        setup();
        // city: the label has no English; the help text is a plain string (Amharic's), so English is missing too
        expect(rowKeys()).toEqual(['city:label', 'city:props.helpText']);
        const label = document.querySelector('[data-text-row="city:label"]') as HTMLElement;
        expect(within(label).getAllByText('Missing')).toHaveLength(1);
        expect(within(label).getAllByText('Not translated')).toHaveLength(1);
        expect(screen.getByText('Wolayttatto')).toBeInTheDocument();
        expect(screen.getByText('2 to translate')).toBeInTheDocument();
    });

    it('writes the English cell into the document, drops the count, and undoes', () => {
        const store = setup();
        fireEvent.change(screen.getByLabelText('ከተማ, Label, English'), { target: { value: 'City' } });
        expect(store.getState().doc.byId.city?.label).toEqual({ am: 'ከተማ', en: 'City' });
        // the row stays while the person types in it
        expect(rowKeys()).toContain('city:label');
        expect(screen.getByText('1 to translate')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('ከተማ, Help text, English'), { target: { value: 'Town' } });
        expect(store.getState().doc.byId.city?.props.helpText).toEqual({ am: 'Where you live', en: 'Town' });
        expect(screen.getByText('All translated')).toBeInTheDocument();
        store.getState().actions.undo();
        expect(store.getState().doc.byId.city?.props.helpText).toBe('Where you live');
    });

    it('filters: all texts with the switch off, and by search', () => {
        setup();
        fireEvent.click(screen.getByRole('switch', { name: 'Only untranslated' }));
        expect(rowKeys()).toHaveLength(5); // 3 labels, the help text, the option
        fireEvent.change(screen.getByLabelText('Search the texts'), { target: { value: 'kind' } });
        expect(rowKeys()).toEqual(['kind:label', 'kind:props.options.0.label']);
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
        fireEvent.change(screen.getByLabelText('Option 1 label'), { target: { value: 'Single' } });
        // a translation never changes what answers store (published answers keep matching)
        expect(seen[0]).toEqual([{ label: { am: 'አንድ', en: 'Single' }, value: 'one', disabled: true, items: [] }]);
    });

    it('never makes a value from an Ethiopic label', () => {
        const seen: unknown[] = [];
        renderEditor(
            <OptionsEditor language="am" value={[{ label: '', value: '' }]} onChange={(rows) => seen.push(rows)} />
        );
        fireEvent.change(screen.getByLabelText('Option 1 label'), { target: { value: 'አንድ' } });
        expect(seen[0]).toEqual([{ label: 'አንድ', value: 'option_1' }]);
    });
});
