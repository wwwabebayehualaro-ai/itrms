import { DndContext } from '@dnd-kit/core';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import '../renderer/fields/registerAll';
import { getFieldType } from '../renderer/kit';
import { amText, enText, hostRenderer } from '../test-utils';
import { EMPTY_DOC, createField, fromStored } from './document';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import { SettingsForm } from './SettingsForm';
import { DesignerProvider, createDesignerStore } from './store';

const palette = (language: 'am' | 'en') =>
    hostRenderer({ language })(
        <DndContext>
            <DesignerProvider value={createDesignerStore()}>
                <Palette />
            </DesignerProvider>
        </DndContext>
    );

describe('the builder palette and field settings in the catalogues', () => {
    it('words the palette in the host language and finds by what is shown and by the English name', async () => {
        palette('am');
        expect(screen.getByRole('navigation', { name: amText('form-engine.palette.ui.fieldsToAdd') })).toBeTruthy();
        expect(screen.getByText(amText('form-engine.palette.group.choices'))).toBeTruthy();
        const button = screen.getByRole('button', {
            name: amText('form-engine.palette.ui.add', { label: amText('form-engine.palette.type.Dropdown.label') })
        });
        expect(button.getAttribute('data-palette')).toBe('Dropdown');
        const search = screen.getByRole('searchbox');
        await userEvent.type(search, enText('form-engine.palette.type.Dropdown.label'));
        expect(screen.getAllByRole('button')).toHaveLength(1); // the English name still finds it
        await userEvent.clear(search);
        await userEvent.type(search, amText('form-engine.palette.type.Dropdown.label'));
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('words the palette in English', () => {
        palette('en');
        expect(screen.getByText('Text & numbers')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Pick one' })).toBeTruthy();
    });

    it("words a type's settings from its schema", () => {
        const schema = getFieldType('Calendar')?.design?.settings;
        hostRenderer({ language: 'am' })(
            <SettingsForm schema={schema} value={() => undefined} own={() => true} onChange={() => {}} idPrefix="t" />
        );
        expect(screen.getByText(amText('form-engine.settings.Calendar.showTime.title'))).toBeTruthy();
        expect(screen.getByText(amText('form-engine.settings.form.more'))).toBeTruthy();
    });

    it('words the inspector and creates fields with an English key and Amharic default texts', () => {
        const dropdown = createField(EMPTY_DOC, 'Dropdown', 'form-engine.palette.type.Dropdown.label', 'am');
        expect(dropdown?.id).toBe('pickOne');
        expect(dropdown?.label).toBe(amText('form-engine.palette.type.Dropdown.label'));
        expect(dropdown?.data?.dataSource?.staticData?.[0]).toEqual({
            label: amText('form-engine.palette.defaults.option', { n: '1' }),
            value: 'option_1'
        });
        const doc = fromStored({ fields: dropdown ? [dropdown] : [] }).doc;
        const store = createDesignerStore(doc);
        store.getState().actions.select('pickOne');
        hostRenderer({ language: 'am' })(
            <DesignerProvider value={store}>
                <Inspector />
            </DesignerProvider>
        );
        expect(screen.getByRole('tab', { name: amText('form-engine.settings.inspector.tabs.options') })).toBeTruthy();
        expect(screen.getByText(amText('form-engine.settings.inspector.field.requiredHelp'))).toBeTruthy();
    });
});

describe('an option value in an Amharic session (task 0.17d)', () => {
    it('lets the placeholder value of a default option follow the first label with letters', async () => {
        const user = userEvent.setup();
        const { OptionsEditor } = await import('./controls');
        const { useState } = await import('react');
        let latest: unknown[] = [];
        const Host = () => {
            const [rows, setRows] = useState<{ label: string; value: string }[]>([
                { label: amText('form-engine.palette.defaults.option', { n: '1' }), value: 'option_1' },
                { label: amText('form-engine.palette.defaults.option', { n: '2' }), value: 'option_2' }
            ]);
            return (
                <OptionsEditor
                    value={rows}
                    onChange={(next) => {
                        latest = next;
                        setRows(next as typeof rows);
                    }}
                />
            );
        };
        hostRenderer({ language: 'am' })(<Host />);
        const second = screen.getByLabelText(amText('form-engine.settings.controls.options.label', { n: '2' }));
        // replaced in one change, as a paste or a test's fill does: the old label "አማራጭ 2" leaves only a digit
        fireEvent.change(second, { target: { value: 'Town' } });
        expect(latest[1]).toEqual({ label: 'Town', value: 'town' });
        // a translation or an Amharic label never changes it again once it has one of its own
        await user.clear(second);
        await user.type(second, 'ከተማ');
        expect(latest[1]).toMatchObject({ value: 'town' });
    });
});
