'use client';

/**
 * The application frame on the design system: a collapsible sidebar (icons only when collapsed on a desktop, a sheet on phones —
 * Ctrl/Cmd+B toggles it), a top bar with the menu toggle, the light/dark switch and the signed-in person's menu, and the footer.
 */
import Link from 'next/link';
import { LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    IconButton,
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
    SidebarTrigger
} from '@platform/ui';
import { useAuthStore } from '@platform/lib/auth/authStore';
import { AppNav } from './AppNav';

function Logo({ className }: { className?: string }) {
    // the logo is drawn for a light background; on dark surfaces the white variant is used
    return (
        <>
            <img src="/layout/images/logo-dark.svg" alt="" className={`dark:hidden ${className ?? ''}`} />
            <img src="/layout/images/logo-white.svg" alt="" className={`hidden dark:block ${className ?? ''}`} />
        </>
    );
}

function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const dark = resolvedTheme === 'dark';
    return (
        <IconButton label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
            {dark ? <Sun /> : <Moon />}
        </IconButton>
    );
}

function UserMenu() {
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const name = user?.full_name || user?.email || 'Account';
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="gap-2" aria-label={`Account: ${name}`}>
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {name
                            .split(/[\s@.]+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p) => p[0]?.toUpperCase())
                            .join('')}
                    </span>
                    <span className="hidden max-w-40 truncate sm:inline">{name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col">
                    <span className="truncate">{user?.full_name || 'Signed in'}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                    <UserRound />
                    {(user?.roles ?? []).join(', ') || 'No role'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void logout()}>
                    <LogOut />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function AppShell({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <Sidebar collapsible="icon" data-app-sidebar>
                <SidebarHeader>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild size="lg" tooltip="Digital File Cabinet">
                                <Link href="/">
                                    <Logo className="size-8 shrink-0" />
                                    <span className="truncate font-semibold">Digital File Cabinet</span>
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
                <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur" data-app-topbar>
                    <SidebarTrigger aria-label="Menu" />
                    <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
                    <span className="truncate text-sm font-medium md:hidden">Digital File Cabinet</span>
                    <div className="ml-auto flex items-center gap-1">
                        <ThemeToggle />
                        <UserMenu />
                    </div>
                </header>
                <main className="flex-1 p-3 md:p-6" data-app-main>
                    {children}
                </main>
                <footer className="flex items-center justify-center gap-2 border-t py-3 text-xs text-muted-foreground">
                    <Logo className="h-4 w-auto" />
                    by <span className="font-medium text-foreground">DreamerABA</span>
                </footer>
            </SidebarInset>
        </SidebarProvider>
    );
}
