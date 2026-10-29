// A service on the screens (task 0.21c): an office's configuration with where each value comes from, a time limit
// changed for an office below the person's (the whole override sent, with the version read), the request form with the
// office's help texts in place.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api, isApiError: () => false }));

import { NotifyProvider } from '@itrms/ui';
import { withHelp } from '@/form-templates/serviceForm';
import { messagesFor } from '@/i18n/messages';
import { useAuthStore, type Workspace } from '@/lib/auth/authStore';
import { ServiceDetail } from '@/screens/services/ServiceDetail';
import { renderWithQuery } from './test-utils';

const zone = { id: 'z1', code: 'WOL', name: { am: 'ወላይታ ዞን', en: 'Wolaita Zone' }, path: 'a' };
const damot = { id: 'w1', code: 'WOL-DAMOT-GALE', name: { am: 'ዳሞት ጋሌ', en: 'Damot Gale' }, path: 'a.b' };
const configuration = {
    serviceCode: 'RS-04',
    version: { id: 'v2', number: 2 },
    states: [{ key: 'review', label: { am: 'ማጣራት', en: 'Review' } }],
    fields: ['plate'],
    values: {
        'sla.review': { value: { businessHours: 8 }, source: { level: 'default' } },
        'help.plate': { value: { am: 'ሰሌዳ', en: 'The plate' }, source: { level: 'unit', unitId: 'z1' } }
    },
    own: { values: { 'help.plate': { am: 'ሰሌዳ', en: 'The plate' } }, reason: 'local', version: 3 },
    problems: [],
    writable: true
};

beforeEach(() => {
    api.get.mockReset().mockImplementation((url: string) => {
        if (url === 'v1/services') return Promise.resolve({ data: [{ code: 'RS-04', name: { en: 'Safety clubs' } }] });
        if (url.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (url.endsWith('/subtree')) return Promise.resolve({ data: [zone, damot] });
        if (url.endsWith('/configuration')) return Promise.resolve({ data: configuration });
        return Promise.resolve({ data: { items: [] } });
    });
    api.put.mockReset().mockResolvedValue({ data: {} });
    useAuthStore.setState({
        workspace: { activeUnit: { id: 'z1', regionId: 'r1', code: 'WOL', name: zone.name } } as unknown as Workspace,
        status: 'authenticated',
        user: null
    });
});

const render = () =>
    renderWithQuery(
        <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="Africa/Addis_Ababa">
            <NotifyProvider>
                <ServiceDetail code="RS-04" />
            </NotifyProvider>
        </NextIntlClientProvider>
    );

describe("an office's configuration", () => {
    it('shows each value and where it comes from, and changes a time limit with the whole override and its version', async () => {
        const user = userEvent.setup();
        render();
        const review = await waitFor(() => {
            const row = document.querySelector('[data-config-key="sla.review"]');
            if (!row) throw new Error('no row');
            return within(row as HTMLElement);
        });
        expect(review.getByText('8 working hours')).toBeInTheDocument();
        expect(review.getByText("The region's version")).toBeInTheDocument();
        const help = within(document.querySelector('[data-config-key="help.plate"]') as HTMLElement);
        expect(help.getByText('Wolaita Zone')).toBeInTheDocument();

        await user.click(review.getByRole('button', { name: 'Change' }));
        const dialog = await screen.findByRole('dialog');
        await user.clear(within(dialog).getByLabelText('Amount'));
        await user.type(within(dialog).getByLabelText('Amount'), '3');
        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'Working days' }));
        await user.clear(within(dialog).getByLabelText('Reason'));
        await user.type(within(dialog).getByLabelText('Reason'), 'one officer');
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(api.put).toHaveBeenCalledWith(
                'v1/org-units/z1/services/RS-04/override',
                {
                    values: { 'help.plate': { am: 'ሰሌዳ', en: 'The plate' }, 'sla.review': { businessDays: 3 } },
                    reason: 'one officer'
                },
                { headers: { 'if-match': '"3"' } }
            )
        );
    });
});

describe('the request form', () => {
    it("puts the office's help texts on the fields they name, by key", () => {
        const fields = withHelp(
            {
                fields: [
                    { id: 'plate', type: 'InputText', props: { required: true } },
                    { id: 'remark', type: 'InputText' }
                ]
            },
            {
                plate: { am: 'ሰሌዳ', en: 'The plate' }
            }
        );
        expect(fields[0]?.props).toEqual({ required: true, helpText: { am: 'ሰሌዳ', en: 'The plate' } });
        expect(fields[1]?.props).toBeUndefined();
        expect(withHelp(null, {})).toEqual([]);
    });
});
