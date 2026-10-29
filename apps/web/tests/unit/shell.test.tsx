// The application shell (tasks 0.10b, 0.13; ADR-0028): the sidebar draws the menu the API computed, in the person's
// language, with their favourites, which are saved on the server; the icon map covers every icon the manifests name; the
// merged catalogues nest and fall back.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@itrms/ui';
import { messagesFor, nest, type UiLanguage } from '@/i18n/messages';
import { useAuthStore, type Workspace } from '@/lib/auth/authStore';
import { setPreferencesSaver, usePreferences, type StoredPreferences } from '@/lib/preferences';
import { AppNav, itemAt } from '@/shell/AppNav';
import { MENU_ICONS } from '@/shell/menu-icons.generated';
import { MENU_MANIFESTS } from '../../scripts/shell/manifests';

vi.mock('next/navigation', () => ({
    usePathname: () => '/competency/applications/0193',
    useRouter: () => ({ refresh: () => undefined, push: () => undefined })
}));

const item = (key: string, route: string, am: string, en: string, icon = 'circle') => ({
    key,
    route,
    icon,
    label: { am, en },
    quickActions: []
});

const workspace: Workspace = {
    user: { id: 'u-1', username: 'demo.officer', displayName: 'Officer (demo)' },
    activeUnit: {
        id: 'unit-1',
        regionId: 'region-1',
        code: 'WOL-BODITI',
        name: { am: 'ቦዲቲ', en: 'Boditi' },
        services: [],
        capabilities: []
    },
    units: [],
    roles: ['competency.officer'],
    permissions: ['licence:read'],
    settings: {},
    roleLabels: {},
    preferences: {},
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

// the badges read their counts (task 0.20d); none are asked for here (the person holds no case or approval right)
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const nav = (locale: UiLanguage) => (
    <QueryClientProvider client={queries}>
        <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Africa/Addis_Ababa">
            <SidebarProvider>
                <AppNav />
            </SidebarProvider>
        </NextIntlClientProvider>
    </QueryClientProvider>
);

let saved: StoredPreferences[] = [];

beforeEach(() => {
    saved = [];
    setPreferencesSaver((p) => Promise.resolve(void saved.push(p)));
    usePreferences.setState({ loaded: true, favourites: [], recents: [], calendar: 'ethiopian' });
    useAuthStore.setState({ workspace, status: 'authenticated', user: null });
});

describe('the menu icons (navigation-and-menus.md §7)', () => {
    it('hold every icon the installed manifests name (pnpm --filter @itrms/web gen:icons)', () => {
        const named = MENU_MANIFESTS.flatMap((m) => m.menu.map((i) => i.icon));
        expect(named.filter((n) => !MENU_ICONS[n])).toEqual([]);
    });
});

describe('the catalogues (task 0.13)', () => {
    it('nest the flat keys and refuse a key that is also a prefix', () => {
        expect(nest({ 'a.b': 'x', 'a.c.d': 'y' })).toEqual({ a: { b: 'x', c: { d: 'y' } } });
        expect(() => nest({ 'a.b': 'x', 'a.b.c': 'y' })).toThrow(/prefix|message itself/);
    });

    it('fill Wolaytta from Amharic, then English', () => {
        const wal = messagesFor('wal-Latn') as { shell: { app: { menu: string } } };
        const am = messagesFor('am') as { shell: { app: { menu: string } } };
        expect(wal.shell.app.menu).toBe(am.shell.app.menu);
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
        const { rerender } = render(nav('am'));
        const menu = screen.getByRole('navigation');
        expect(within(menu).getByText('ብቃት')).toBeTruthy();
        expect(within(menu).getByRole('link', { name: 'ማመልከቻዎች' }).getAttribute('aria-current')).toBe('page');
        rerender(nav('en'));
        expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Applications' })).toBeTruthy();
        expect(within(screen.getByRole('navigation')).getByText('Competency')).toBeTruthy();
    });

    it('pins favourites on top, remembers the pages opened, and saves both on the server', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            render(nav('am'));
            expect(usePreferences.getState().recents.map((r) => r.key)).toEqual(['competency.applications']);
            await userEvent.click(screen.getAllByRole('button', { name: 'ወደ ተወዳጆች ጨምር' })[2] as HTMLElement);
            const favourites = document.querySelector('[data-nav-group="favourites"]') as HTMLElement;
            const pinned = within(favourites).getByRole('link', { name: 'ፈተናዎች' });
            // only the item in its own group is the current page's
            expect(pinned.getAttribute('aria-current')).toBeNull();
            await act(() => vi.advanceTimersByTimeAsync(1000));
            // only what changed: the server keeps the rest
            expect(saved).toEqual([
                {
                    favourites: ['competency.exams'],
                    recents: [expect.objectContaining({ key: 'competency.applications' })]
                }
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('saves nothing before the server preferences arrive, and then takes them whole', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            usePreferences.setState({ loaded: false });
            render(nav('am'));
            // the page visit is kept on this page only: sent now, it would replace the person's pages on the server
            await act(() => vi.advanceTimersByTimeAsync(61_000));
            expect(saved).toEqual([]);
            act(() =>
                usePreferences.getState().load({ calendar: 'gregorian', favourites: ['competency.exams'], recents: [] })
            );
            await act(() => vi.advanceTimersByTimeAsync(61_000));
            expect(saved).toEqual([]);
            expect(usePreferences.getState()).toMatchObject({
                calendar: 'gregorian',
                favourites: ['competency.exams']
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('sends the pages opened at most once a minute', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const { visit } = usePreferences.getState();
            act(() => visit('a'));
            await act(() => vi.advanceTimersByTimeAsync(30_000));
            act(() => visit('b'));
            await act(() => vi.advanceTimersByTimeAsync(31_000));
            expect(saved).toHaveLength(1);
            expect(saved[0]?.recents?.map((r) => r.key)).toEqual(['b', 'a']);
        } finally {
            vi.useRealTimers();
        }
    });
});
