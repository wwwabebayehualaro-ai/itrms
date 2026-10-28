'use client';

/**
 * The application frame (ADR-0028, navigation-and-menus.md §4): a collapsible sidebar with the person's menu here (icons only
 * when collapsed on a desktop, a sheet on phones; Ctrl/Cmd+B toggles it), and a top bar with the unit the person acts for,
 * the command palette (Ctrl/Cmd+K), the appearance menu and the user menu with their preferences.
 */
import Link from 'next/link';
import { CalendarDays, Languages, LogOut, UserRound } from 'lucide-react';
import {
    confirmAction,
    AppearanceMenu,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
    Separator,
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
    type AppearanceLabels
} from '@itrms/ui';
import { NO_LABELS, useAuthStore } from '@/lib/auth/authStore';
import { forgetLocalDrafts, unsyncedCount } from '@/lib/drafts';
import {
    CALENDARS,
    LANGUAGE_NAMES,
    availableLanguages,
    usePreferences,
    useSetLanguage,
    useText,
    type Calendar,
    type Language
} from '@/lib/preferences';
import { AppNav } from './AppNav';
import { CommandPalette } from './CommandPalette';
import { NotificationsBell } from './NotificationsBell';
import { UnitSwitcher } from './UnitSwitcher';

function Logo({ className }: { className?: string }) {
    // the logo is drawn for a light background; on dark surfaces the white variant is used
    return (
        <>
            <img src="/layout/images/logo-dark.svg" alt="" className={`dark:hidden ${className ?? ''}`} />
            <img src="/layout/images/logo-white.svg" alt="" className={`hidden dark:block ${className ?? ''}`} />
        </>
    );
}

function UserMenu() {
    const { t, text, language } = useText();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const { calendar, setCalendar } = usePreferences();
    const setLanguage = useSetLanguage();
    const roleLabels = useAuthStore((s) => s.workspace?.roleLabels ?? NO_LABELS);
    const languages = availableLanguages(useAuthStore((s) => s.workspace?.settings['i18n.languages']));
    const name = user?.full_name || user?.username || t('shell.user.signedIn');
    // an explicit sign-out deletes this browser's drafts and their key (SEC-WB-3); drafts the server does not have yet
    // are lost with them, so it asks first
    const signOut = async () => {
        // the browser's storage failing (blocked, full) never keeps a person from signing out
        const unsaved = user ? await unsyncedCount(user.id).catch(() => 0) : 0;
        const leave = async () => {
            try {
                if (user) await forgetLocalDrafts(user.id);
            } finally {
                logout();
            }
        };
        if (unsaved === 0) return leave();
        void confirmAction({
            header: t('shell.user.unsavedDraftsTitle'),
            message: t('shell.user.unsavedDrafts', { count: String(unsaved) }),
            acceptLabel: t('shell.user.signOutAnyway'),
            danger: true,
            onAccept: leave
        });
    };
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    aria-label={t('shell.user.account', { name })}
                    data-user-menu
                >
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {name
                            .split(/[\s@.]+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p) => p[0]?.toUpperCase())
                            .join('')}
                    </span>
                    <span className="hidden max-w-40 truncate lg:inline">{name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col">
                    <span className="truncate">{user?.full_name || t('shell.user.signedIn')}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{user?.username}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                    <UserRound />
                    {(user?.roles ?? []).map((r) => (roleLabels[r] ? text(roleLabels[r]) : r)).join(', ') ||
                        t('shell.user.noRole')}
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <Languages />
                        {t('shell.prefs.language')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup value={language} onValueChange={(v) => void setLanguage(v as Language)}>
                            {languages.map((l) => (
                                <DropdownMenuRadioItem key={l} value={l} lang={l}>
                                    {LANGUAGE_NAMES[l]}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <CalendarDays />
                        {t('shell.prefs.calendar.title')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup value={calendar} onValueChange={(v) => setCalendar(v as Calendar)}>
                            {CALENDARS.map((c) => (
                                <DropdownMenuRadioItem key={c} value={c}>
                                    {t(
                                        c === 'ethiopian'
                                            ? 'shell.prefs.calendar.ethiopian'
                                            : 'shell.prefs.calendar.gregorian'
                                    )}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()} data-sign-out>
                    <LogOut />
                    {t('shell.user.signOut')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function useAppearanceLabels(): AppearanceLabels {
    const { t } = useText();
    return {
        trigger: t('shell.appearance.trigger'),
        theme: t('shell.appearance.theme'),
        density: t('shell.appearance.density'),
        themes: {
            system: t('shell.appearance.system'),
            light: t('shell.appearance.light'),
            dark: t('shell.appearance.dark'),
            'high-contrast': t('shell.appearance.highContrast')
        },
        densities: { comfortable: t('shell.appearance.comfortable'), compact: t('shell.appearance.compact') }
    };
}

export function AppShell({ children }: { children: React.ReactNode }) {
    const { t } = useText();
    const appearance = useAppearanceLabels();
    return (
        <SidebarProvider>
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2"
            >
                {t('shell.app.skip')}
            </a>
            <Sidebar collapsible="icon" data-app-sidebar>
                <SidebarHeader>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild size="lg" tooltip={t('shell.app.name')}>
                                <Link href="/">
                                    <Logo className="size-8 shrink-0" />
                                    <span className="truncate font-semibold">{t('shell.app.name')}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarHeader>
                <SidebarContent>
                    <AppNav />
                </SidebarContent>
                <SidebarFooter />
                <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-w-0">
                <header
                    className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur"
                    data-app-topbar
                >
                    <SidebarTrigger aria-label={t('shell.app.menu')} />
                    <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
                    <UnitSwitcher />
                    <div className="ml-auto flex items-center gap-1">
                        <CommandPalette />
                        <NotificationsBell />
                        <AppearanceMenu labels={appearance} />
                        <UserMenu />
                    </div>
                </header>
                <main id="main" className="flex-1 p-3 md:p-6" data-app-main>
                    {children}
                </main>
                <footer className="flex items-center justify-center gap-2 border-t py-3 text-xs text-muted-foreground">
                    <Logo className="h-4 w-auto" />
                    <span className="font-medium text-foreground">{t('shell.app.name')}</span>·
                    <span>{t('shell.app.vendor')}</span>
                </footer>
            </SidebarInset>
        </SidebarProvider>
    );
}
