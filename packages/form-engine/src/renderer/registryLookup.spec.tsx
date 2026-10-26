import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type * as UI from '@itrms/ui';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), show: vi.fn() }));
vi.mock('@itrms/ui', async (original) => ({ ...(await original<typeof UI>()), useNotify: () => notify }));

import type { LookupItem } from '../host/lookups';
import { amText, hostRenderer } from '../test-utils';
import { EngineForm } from './EngineForm';

const ID = '0b8f7a52-3c1d-4e6a-9f10-5d2c8e7b1a34';
const OTHER = '5a1c9e22-7d3b-4c80-8a46-1f9e0b2d6c57';

const sample: LookupItem = {
    id: ID,
    label: 'Sample Person One',
    active: true,
    facts: [
        { key: 'sex', label: 'Sex', value: 'F' },
        { key: 'unit', label: 'Handling unit', value: 'Sample Zone' },
        { key: 'birthYear', label: 'Birth year', value: null }
    ]
};
const other: LookupItem = { ...sample, id: OTHER, label: 'Sample Person Two', facts: [] };

const answer = <T,>(data: T) => Promise.resolve({ data, status: 200, headers: {} });

/** A registry that finds `sample` and `other` for "sam" and answers the items call from `known`. */
function registry(known: LookupItem[] = [sample, other]) {
    return vi.fn((url: string, options?: { params?: { q?: string; ids?: string } }) => {
        if (url.endsWith('/items'))
            return answer({ items: known.filter((i) => (options?.params?.ids ?? '').split(',').includes(i.id)) });
        return answer({ items: options?.params?.q === 'sam' ? [sample, other] : [] });
    });
}

const field = (props: Record<string, unknown> = {}) => ({
    id: 'owner',
    type: 'RegistryLookup',
    label: 'Owner',
    category: 'Input',
    props: { provider: 'person', ...props },
    data: { defaultProps: {} },
    behavior: { validation: { supported: true } },
    layout: { options: { isContainer: false } }
});

function show(get: ReturnType<typeof registry>, initialValues: Record<string, unknown> = {}, disabled = false) {
    const onFormSubmit = vi
        .fn<(submission: { submission_data: Record<string, unknown> }) => Promise<void>>()
        .mockResolvedValue(undefined);
    const fields = [field()];
    hostRenderer({ client: { get: get as never } })(
        <EngineForm
            fields={fields}
            template={{ id: 'tpl-1', name: 'Licence', form_config: { fields } } as never}
            onFormSubmit={onFormSubmit}
            initialValues={initialValues}
            readOnly={disabled}
        />
    );
    return onFormSubmit;
}

describe('the registry lookup field (task 0.18)', () => {
    it('searches the registry as the person types, fills the facts when one is picked and submits only its id', async () => {
        const user = userEvent.setup();
        const get = registry();
        const onFormSubmit = show(get);
        await user.click(screen.getByRole('combobox', { name: /Owner/ }));
        await user.type(screen.getByPlaceholderText(amText('form-engine.renderer.lookup.searchPlaceholder')), 'sam');
        await user.click(await screen.findByText('Sample Person One'));
        expect(get).toHaveBeenCalledWith(
            'v1/registry-lookups/person',
            expect.objectContaining({ params: { q: 'sam' } })
        );
        // the facts are read-only text under the box; a fact without a value is left out
        const facts = (await screen.findByText('Sample Zone')).closest('dl');
        expect(facts?.getAttribute('aria-label')).toBe(amText('form-engine.renderer.lookup.factsLabel'));
        expect(facts?.textContent).toContain('Sample Zone');
        expect(facts?.textContent).not.toContain('Birth year');
        await user.click(screen.getByRole('button', { name: amText('form-engine.renderer.submit.label') }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0]).toMatchObject({ submission_data: { owner: ID } });
    });

    it('asks for two letters before it searches', async () => {
        const user = userEvent.setup();
        const get = registry();
        show(get);
        await user.click(screen.getByRole('combobox', { name: /Owner/ }));
        await user.type(screen.getByPlaceholderText(amText('form-engine.renderer.lookup.searchPlaceholder')), 's');
        expect(screen.getByText(amText('form-engine.renderer.lookup.minChars'))).toBeTruthy();
        expect(get).not.toHaveBeenCalled();
    });

    it('clears the answer', async () => {
        const user = userEvent.setup();
        const onFormSubmit = show(registry(), { owner: ID });
        expect(await screen.findByText('Sample Person One')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: amText('form-engine.renderer.lookup.clear') }));
        await user.click(screen.getByRole('button', { name: amText('form-engine.renderer.submit.label') }));
        await waitFor(() => expect(onFormSubmit).toHaveBeenCalledTimes(1));
        expect(onFormSubmit.mock.calls[0]?.[0].submission_data.owner ?? null).toBeNull();
    });

    it('shows a saved record in a disabled form: its label and facts, read by id', async () => {
        const get = registry();
        show(get, { owner: ID }, true);
        expect(await screen.findByText('Sample Person One')).toBeTruthy();
        expect(await screen.findByText('Sample Zone')).toBeTruthy();
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(get).toHaveBeenCalledWith(
            'v1/registry-lookups/person/items',
            expect.objectContaining({ params: { ids: ID } })
        );
    });

    it('says so when the saved record is inactive', async () => {
        show(registry([{ ...sample, active: false }]), { owner: ID }, true);
        expect(await screen.findByText(amText('form-engine.renderer.lookup.inactive'))).toBeTruthy();
        expect(screen.getByText('Sample Person One')).toBeTruthy();
    });

    it('says so when the saved record is not found (another region, or not visible)', async () => {
        show(registry([]), { owner: ID }, true);
        expect(await screen.findByText(amText('form-engine.renderer.lookup.notFound'))).toBeTruthy();
    });
});
