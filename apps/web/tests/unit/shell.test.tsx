// The application shell (task 0.10b, ADR-0028): the sidebar draws the menu the API computed, in the person's language,
// with their favourites; the icon map covers every icon the manifests name.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@itrms/ui';
import { useAuthStore, type Workspace } from '@/lib/auth/authStore';
import { usePreferences } from '@/lib/preferences';
import { useShortcuts } from '@/lib/shortcuts';
import { AppNav, itemAt } from '@/shell/AppNav';
import { MENU_ICONS } from '@/shell/menu-icons.generated';
import { MENU_MANIFESTS } from '../../scripts/shell/manifests';

vi.mock('next/navigation', () => ({ usePathname: () => '/competency/applications/0193' }));

const item = (key: string, route: string, am: string, en: string, icon = 'circle') => ({
    key,
    route,
    icon,
    label: { am, en },
    quickActions: []
});

const workspace: Workspace = {
    user: { id: 'u-1', username: 'demo.officer', displayName: 'Officer (demo)' },
    activeUnit: { id: 'unit-1', code: 'WOL-BODITI', name: { am: 'ቦዲቲ', en: 'Boditi' }, services: [], capabilities: [] },
    units: [],
    roles: ['competency.officer'],
    permissions: ['licence:read'],
    settings: {},
    roleLabels: {},
    menu: [
        { key: 'home', label: { am: 'መነሻ', en: 'Home' }, items: [item('kernel.home', '/', 'መነሻ', 'Home', 'house')] },
        {
            key: 'work-process:1',
            label: { am: 'ብቃት', en: 'Competency' },
            items: [
                item('competency.applications', '/competency/applications', 'ማመልከቻዎች', 'Applications', 'id-card'),
                item('competency.exams', '/competency/exams', 'ፈተናዎች', 'Exams', 'clipboard-check')
            ]
        }
    ]
};

const drawNav = () =>
    render(
        <SidebarProvider>
            <AppNav />
        </SidebarProvider>
    );

beforeEach(() => {
    localStorage.clear();
    useShortcuts.setState({ owner: null, favourites: [], recents: [] });
    usePreferences.setState({ language: 'am' });
    useAuthStore.setState({ workspace, status: 'authenticated', user: null });
});

describe('the menu icons (navigation-and-menus.md §7)', () => {
    it('hold every icon the installed manifests name (pnpm --filter @itrms/web gen:icons)', () => {
        const named = MENU_MANIFESTS.flatMap((m) => m.menu.map((i) => i.icon));
        expect(named.filter((n) => !MENU_ICONS[n])).toEqual([]);
    });
});

describe('the sidebar', () => {
    it('marks the item a page belongs to: the longest route that contains it', () => {
        const items = workspace.menu.flatMap((g) => g.items);
        expect(itemAt(items, '/competency/applications/0193')?.key).toBe('competency.applications');
        expect(itemAt(items, '/')?.key).toBe('kernel.home');
        expect(itemAt(items, '/competency/applicationsX')).toBeUndefined();
    });

    it('draws the groups and items in the person’s language, with the current page marked', () => {
        drawNav();
        const nav = screen.getByRole('navigation');
        expect(within(nav).getByText('ብቃት')).toBeTruthy();
        expect(within(nav).getByRole('link', { name: 'ማመልከቻዎች' }).getAttribute('aria-current')).toBe('page');
        act(() => usePreferences.getState().setLanguage('en'));
        expect(within(nav).getByRole('link', { name: 'Applications' })).toBeTruthy();
        expect(within(nav).getByText('Competency')).toBeTruthy();
    });

    it('pins favourites on top, per person, and remembers the pages opened', async () => {
        useAuthStore.setState({
            user: {
                id: 'u-1',
                username: 'demo.officer',
                full_name: null,
                roles: [],
                permissions: [],
                activeUnit: workspace.activeUnit
            }
        });
        drawNav();
        expect(useShortcuts.getState().recents.map((r) => r.key)).toEqual(['competency.applications']);
        await userEvent.click(screen.getAllByRole('button', { name: 'ወደ ተወዳጆች ጨምር' })[2] as HTMLElement);
        const favourites = document.querySelector('[data-nav-group="favourites"]') as HTMLElement;
        expect(within(favourites).getByRole('link', { name: 'ፈተናዎች' })).toBeTruthy();
        expect(JSON.parse(localStorage.getItem('itrms.shortcuts.u-1') ?? '{}')).toMatchObject({
            favourites: ['competency.exams']
        });
        // another person never sees them
        act(() => useShortcuts.getState().load('u-2'));
        expect(useShortcuts.getState().favourites).toEqual([]);
    });
});
