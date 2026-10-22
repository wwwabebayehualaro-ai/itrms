'use client';

/**
 * The sidebar: the menu the API computed for this person in their active unit (`/me/workspace`, ADR-0028), grouped by work
 * process, with their favourites on top. Showing an item is a hint; the API decides every call.
 */
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Star } from 'lucide-react';
import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar
} from '@itrms/ui';
import { useAuthStore, type MenuItem } from '@/lib/auth/authStore';
import { usePreferences, useText } from '@/lib/preferences';
import { MENU_ICONS } from './menu-icons.generated';

/** The menu item a path belongs to: the longest route that is the path or one of its parents. */
export function itemAt(items: readonly MenuItem[], pathname: string): MenuItem | undefined {
    return items
        .filter((i) =>
            i.route === '/' ? pathname === '/' : pathname === i.route || pathname.startsWith(`${i.route}/`)
        )
        .sort((a, b) => b.route.length - a.route.length)[0];
}

export function AppNav() {
    const pathname = usePathname();
    const { setOpenMobile } = useSidebar();
    const { t, text } = useText();
    const menu = useAuthStore((s) => s.workspace?.menu);
    const { favourites, toggleFavourite, visit } = usePreferences();

    const items = useMemo(() => (menu ?? []).flatMap((g) => g.items), [menu]);
    const current = itemAt(items, pathname);

    useEffect(() => {
        if (current) visit(current.key);
    }, [current, visit]);

    const close = () => setOpenMobile(false); // a navigation closes the menu on phones
    // favourites that are no longer in the menu here (another unit, a role taken away) are simply not shown
    const pinned = favourites.flatMap((k) => items.filter((i) => i.key === k));

    const entry = (item: MenuItem, where: string) => {
        const Icon = MENU_ICONS[item.icon] ?? MENU_ICONS.circle;
        const label = text(item.label);
        const isFavourite = favourites.includes(item.key);
        return (
            <SidebarMenuItem key={`${where}:${item.key}`}>
                <SidebarMenuButton asChild isActive={current?.key === item.key} tooltip={label}>
                    <Link
                        href={item.route}
                        onClick={close}
                        aria-current={current?.key === item.key && where !== 'favourite' ? 'page' : undefined}
                        data-menu-item={item.key}
                    >
                        {Icon && <Icon />}
                        <span>{label}</span>
                    </Link>
                </SidebarMenuButton>
                <SidebarMenuAction
                    showOnHover={!isFavourite}
                    onClick={() => toggleFavourite(item.key)}
                    aria-label={t(isFavourite ? 'shell.nav.unpin' : 'shell.nav.pin')}
                    aria-pressed={isFavourite}
                >
                    <Star className={isFavourite ? 'fill-current' : undefined} />
                </SidebarMenuAction>
            </SidebarMenuItem>
        );
    };

    return (
        <nav aria-label={t('shell.app.menu')}>
            {pinned.length > 0 && (
                <SidebarGroup data-nav-group="favourites">
                    <SidebarGroupLabel>{t('shell.nav.favourites')}</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>{pinned.map((i) => entry(i, 'favourite'))}</SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            )}
            {(menu ?? []).map((group) => (
                <SidebarGroup key={group.key} data-nav-group={group.key}>
                    <SidebarGroupLabel>{text(group.label)}</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>{group.items.map((i) => entry(i, group.key))}</SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            ))}
        </nav>
    );
}
