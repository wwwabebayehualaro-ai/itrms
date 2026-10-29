// The person's look (task 0.21a): the shell applies the workspace's theme and density, keeps a choice as the person's
// own, and a choice of the office's value removes theirs, so a later change of the office's reaches them.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ put: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ default: api }));

import { AppearanceProvider, useAppearance } from '@itrms/ui';
import { useAuthStore, type Workspace } from '@/lib/auth/authStore';
import { usePersonalAppearance } from '@/shell/appearance';

const workspace = (settings: Record<string, unknown>, officeSettings: Record<string, unknown>) =>
    ({ settings, officeSettings }) as unknown as Workspace;

const hook = () =>
    renderHook(() => ({ onChange: usePersonalAppearance(), look: useAppearance() }), {
        wrapper: ({ children }) => <AppearanceProvider>{children}</AppearanceProvider>
    });

beforeEach(() => {
    api.put.mockReset().mockResolvedValue({ data: {} });
    api.delete.mockReset().mockResolvedValue({ data: undefined });
    window.localStorage.clear();
});

describe("the person's look", () => {
    it("applies the workspace's density, and keeps a choice that differs from the office's as their own", async () => {
        useAuthStore.setState({
            workspace: workspace({ 'ui.density': 'compact' }, { 'ui.density': 'compact', 'ui.theme': 'system' })
        });
        const { result } = hook();
        await waitFor(() => expect(result.current.look.density).toBe('compact'));
        act(() => result.current.onChange({ density: 'comfortable' }));
        expect(api.put).toHaveBeenCalledWith('v1/me/settings/ui.density', { value: 'comfortable' });
        // the office's own theme: no choice of theirs, so theirs is removed
        act(() => result.current.onChange({ theme: 'system' }));
        expect(api.delete).toHaveBeenCalledWith('v1/me/settings/ui.theme');
        expect(api.put).toHaveBeenCalledTimes(1);
    });
});
