import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api }));

import { FeatureFlagsAdmin } from '@/screens/FeatureFlagsAdmin';
import { FeatureGate } from '@/screens/FeatureGate';
import { renderWithQuery } from './test-utils';

const modules = (flags: Record<string, boolean>) => ({ data: { modules: [], nav: [], flags } });

describe('FeatureGate', () => {
    beforeEach(() => api.get.mockReset());

    it('renders children when the flag is on and the fallback when it is off', async () => {
        api.get.mockResolvedValue(modules({ 'forms.require_approval': true, 'module.files': false }));
        renderWithQuery(
            <>
                <FeatureGate flag="forms.require_approval">
                    <span>approvals on</span>
                </FeatureGate>
                <FeatureGate flag="module.files" fallback={<span>files off</span>}>
                    <span>files on</span>
                </FeatureGate>
            </>
        );
        expect(await screen.findByText('approvals on')).toBeInTheDocument();
        expect(screen.getByText('files off')).toBeInTheDocument();
        expect(screen.queryByText('files on')).not.toBeInTheDocument();
        expect(api.get).toHaveBeenCalledTimes(1); // one request serves every flag
    });
});

describe('FeatureFlagsAdmin', () => {
    const flags = [
        {
            key: 'module.platform',
            description: 'Modules and feature flags',
            kind: 'module',
            default: true,
            enabled: true,
            overridden: false,
            locked: true
        },
        {
            key: 'module.files',
            description: 'File uploads',
            kind: 'module',
            default: true,
            enabled: false,
            overridden: true,
            locked: false
        },
        {
            key: 'forms.require_approval',
            description: 'Publishing a form needs approval',
            kind: 'feature',
            default: false,
            enabled: false,
            overridden: false,
            locked: false
        }
    ];

    beforeEach(() => {
        api.get.mockReset().mockResolvedValue({ data: flags });
        api.put.mockReset().mockImplementation(async (url: string, body: { enabled: boolean | null }) => ({
            data: { ...flags[2], enabled: !!body.enabled, overridden: body.enabled !== null }
        }));
    });

    it('lists flags, locks platform modules and switches a feature', async () => {
        renderWithQuery(<FeatureFlagsAdmin />);
        const row = (key: string) => document.querySelector(`[data-flag="${key}"]`) as HTMLElement;
        await screen.findByText('Publishing a form needs approval');

        expect(within(row('module.platform')).getByRole('switch')).toBeDisabled();
        expect(within(row('module.platform')).getByText('Always on')).toBeInTheDocument();
        expect(within(row('module.files')).getByText('Changed')).toBeInTheDocument();

        await userEvent.click(within(row('forms.require_approval')).getByRole('switch'));
        await waitFor(() =>
            expect(api.put).toHaveBeenCalledWith('platform/flags/forms.require_approval', { enabled: true })
        );

        await userEvent.click(within(row('module.files')).getByRole('button', { name: /reset module.files/i }));
        await waitFor(() => expect(api.put).toHaveBeenCalledWith('platform/flags/module.files', { enabled: null }));
    });

    it('filters by search text', async () => {
        renderWithQuery(<FeatureFlagsAdmin />);
        await screen.findByText('File uploads');
        await userEvent.type(screen.getByLabelText('Search flags'), 'approval');
        expect(screen.queryByText('File uploads')).not.toBeInTheDocument();
        expect(screen.getByText('Publishing a form needs approval')).toBeInTheDocument();
    });
});
