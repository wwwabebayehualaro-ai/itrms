// The settings screen (task 0.21a, ADR-0026): each value with where it comes from, a change of the unit's own value or of
// the region's value for its type with the version read, a reset after a confirmation, and another administrator's
// change since refused and read again.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api, isApiError: (e: unknown) => e instanceof ApiError }));

import { NotifyProvider } from '@itrms/ui';
import { messagesFor } from '@/i18n/messages';
import { ApiError } from '@/lib/api/http';
import { useAuthStore, type Workspace } from '@/lib/auth/authStore';
import { SettingsAdmin } from '@/screens/SettingsAdmin';
import { renderWithQuery } from './test-utils';

const region = { id: 'r1', name: { am: 'ደቡብ ኢትዮጵያ', en: 'South Ethiopia' } };
const zone = { id: 'z1', name: { am: 'ወላይታ ዞን', en: 'Wolaita Zone' } };
const woreda = { id: 'w1', name: { am: 'ዳሞት ጋሌ', en: 'Damot Gale' } };

const density = {
    key: 'ui.density',
    owner: 'kernel',
    name: { am: 'ጥግግት', en: 'Density' },
    options: [
        { value: 'comfortable', name: { am: 'ሰፊ', en: 'Comfortable' } },
        { value: 'compact', name: { am: 'የታመቀ', en: 'Compact' } }
    ],
    overridableAt: ['region', 'unit', 'unitType'],
    userPreference: true,
    sensitive: false,
    schema: { type: 'string', enum: ['comfortable', 'compact'] },
    value: 'comfortable',
    source: { level: 'unit', unitId: 'z1' },
    inherited: { value: 'comfortable', source: { level: 'unit', unitId: 'z1' } },
    own: null,
    unitType: null,
    writable: { unit: true, unitType: true }
};
const keepDays = {
    key: 'forms.exports.keepDays',
    owner: 'forms',
    name: { am: 'ቀናት', en: 'Days a background export is kept' },
    options: null,
    overridableAt: ['region'],
    userPreference: false,
    sensitive: false,
    schema: { type: 'integer', minimum: 1, maximum: 90 },
    value: 5,
    source: { level: 'region', unitId: 'r1' },
    inherited: { value: 5, source: { level: 'region', unitId: 'r1' } },
    own: null,
    unitType: null,
    writable: { unit: false, unitType: false }
};
const theme = {
    ...density,
    key: 'ui.theme',
    name: { am: 'ቀለም', en: 'Theme' },
    options: [{ value: 'dark', name: { am: 'ጨለማ', en: 'Dark' } }],
    schema: { type: 'string', enum: ['dark'] },
    value: 'dark',
    source: { level: 'unit', unitId: 'w1' },
    inherited: { value: 'dark', source: { level: 'default' } },
    own: { value: 'dark', version: 3 }
};
const settings = {
    unitId: 'w1',
    unitType: { id: 't1', name: { am: 'ምድብ 1 ወረዳ', en: 'Category 1 woreda office' } },
    units: [region, zone, woreda],
    settings: [density, keepDays, theme]
};

const workspace = {
    activeUnit: { id: 'w1', regionId: 'r1', code: 'WOL-DAMOT-GALE', name: woreda.name, services: [], capabilities: [] }
} as unknown as Workspace;

const render = () =>
    renderWithQuery(
        <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="Africa/Addis_Ababa">
            <NotifyProvider>
                <SettingsAdmin />
            </NotifyProvider>
        </NextIntlClientProvider>
    );

const row = async (key: string) => {
    const found = await waitFor(() => {
        const r = document.querySelector(`[data-setting="${key}"]`);
        if (!r) throw new Error(`no row ${key}`);
        return r as HTMLElement;
    });
    return within(found);
};

beforeEach(() => {
    api.get.mockReset().mockImplementation((url: string) =>
        Promise.resolve({
            data: url.endsWith('/subtree') ? [{ ...woreda, code: 'WOL-DAMOT-GALE', path: 'a' }] : settings
        })
    );
    api.put.mockReset().mockResolvedValue({ data: {} });
    api.delete.mockReset().mockResolvedValue({ data: undefined });
    useAuthStore.setState({ workspace, status: 'authenticated', user: null, hydrate: () => Promise.resolve() });
});

describe('the settings screen', () => {
    it('shows each value, where it comes from, and what the unit would inherit', async () => {
        render();
        const d = await row('ui.density');
        expect(d.getByText('Comfortable')).toBeInTheDocument();
        expect(d.getByText('Wolaita Zone')).toBeInTheDocument();
        const k = await row('forms.exports.keepDays');
        expect(k.getByText('South Ethiopia')).toBeInTheDocument();
        // the region's choice: shown, not changed here
        expect(k.queryByRole('button', { name: 'Change' })).toBeNull();
        const t = await row('ui.theme');
        expect(t.getByText('This office')).toBeInTheDocument();
        expect(t.getByText('Without it: Dark (Default)')).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith('v1/org-units/w1/settings', expect.anything());
    });

    it("changes the unit's own value, or the region's for every unit of its type, with the version read", async () => {
        const user = userEvent.setup();
        render();
        await user.click((await row('ui.density')).getByRole('button', { name: 'Change' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('combobox', { name: 'Value' }));
        await user.click(await screen.findByRole('option', { name: 'Compact' }));
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(api.put).toHaveBeenCalledWith(
                'v1/org-units/w1/settings/ui.density',
                { value: 'compact' },
                { headers: { 'if-match': '"0"' } }
            )
        );

        await user.click((await row('ui.density')).getByRole('button', { name: 'Change' }));
        const again = await screen.findByRole('dialog');
        await user.click(within(again).getByLabelText('For every office of its type: Category 1 woreda office'));
        await user.click(within(again).getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(api.put).toHaveBeenLastCalledWith(
                'v1/unit-types/t1/settings/ui.density',
                { value: 'comfortable' },
                { headers: { 'if-match': '"0"' } }
            )
        );
    });

    it('resets after a confirmation, and says when another administrator changed it meanwhile', async () => {
        const user = userEvent.setup();
        api.delete.mockRejectedValueOnce(
            new ApiError('changed', 'ERR_BAD_RESPONSE', { url: 'x' }, { status: 409, headers: {}, data: {} })
        );
        render();
        await user.click((await row('ui.theme')).getByRole('button', { name: 'Reset' }));
        await user.click(await screen.findByRole('button', { name: 'Reset' }));
        await waitFor(() =>
            expect(api.delete).toHaveBeenCalledWith('v1/org-units/w1/settings/ui.theme', {
                headers: { 'if-match': '"3"' }
            })
        );
        expect(
            await screen.findByText(
                'Another administrator changed this setting meanwhile. Check it and change it again.'
            )
        ).toBeInTheDocument();
    });
});
