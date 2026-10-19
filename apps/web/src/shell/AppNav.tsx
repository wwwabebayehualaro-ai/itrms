'use client';

/**
 * The sidebar's menu, from the backend's module registry (enabled modules, filtered by the user's permissions). The registry
 * leaves "slots" for the client to fill: `form-templates` becomes the tenant's forms, grouped by category.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    useSidebar
} from '@itrms/ui';
import { useVisibleTemplates } from '@/form-engine';
import { useModules, type NavItem } from '@/lib/modules';
import { navIcon } from './navIcons';

interface Entry {
    label: string;
    icon?: string | null;
    to?: string;
    items?: Entry[];
    disabled?: boolean;
}

export function AppNav() {
    const pathname = usePathname();
    const { setOpenMobile } = useSidebar();
    const { data: templates = [] } = useVisibleTemplates();
    const { data: modules } = useModules();

    const groups = useMemo(() => {
        const byCategory = new Map<string, typeof templates>();
        templates.forEach((t) =>
            byCategory.set(t.category || 'Uncategorized', [...(byCategory.get(t.category || 'Uncategorized') ?? []), t])
        );
        const forms: Entry[] = [...byCategory].map(([category, list]) => ({
            label: category,
            icon: 'folder',
            items: list.map((t) => ({
                label: t.name,
                icon: t.thumbnail_url ? 'file-image' : 'file',
                to: `/submitted-forms/template/${t.id || t.slug}`
            }))
        }));
        const slots: Record<string, Entry[]> = { 'form-templates': forms };
        const toEntry = (n: NavItem): Entry => ({
            label: n.label,
            icon: n.icon,
            to: n.route ?? undefined,
            items: n.slot ? (slots[n.slot] ?? []) : n.children?.length ? n.children.map(toEntry) : undefined
        });
        return [
            { title: 'Home', items: [{ label: 'Dashboard', icon: 'house', to: '/' }] as Entry[] },
            ...(modules?.nav ?? []).map((g) => ({ title: g.title, items: g.items.map(toEntry) }))
        ];
    }, [templates, modules]);

    const close = () => setOpenMobile(false); // a navigation closes the menu on phones
    const active = (to?: string) =>
        !!to && (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
    const contains = (e: Entry): boolean => active(e.to) || !!e.items?.some(contains);

    const leaf = (e: Entry, sub = false) => {
        const Icon = navIcon(e.icon);
        const Button = sub ? SidebarMenuSubButton : SidebarMenuButton;
        return e.to && !e.disabled ? (
            <Button asChild isActive={active(e.to)} {...(!sub && { tooltip: e.label })}>
                <Link href={e.to} onClick={close}>
                    <Icon />
                    <span>{e.label}</span>
                </Link>
            </Button>
        ) : (
            <Button aria-disabled className="opacity-60">
                <Icon />
                <span>{e.label}</span>
            </Button>
        );
    };

    const branch = (e: Entry, sub = false) => {
        const Icon = navIcon(e.icon);
        const Item = sub ? SidebarMenuSubItem : SidebarMenuItem;
        const Button = sub ? SidebarMenuSubButton : SidebarMenuButton;
        return (
            <Collapsible key={e.label} asChild defaultOpen={contains(e)} className="group/collapsible">
                <Item>
                    <CollapsibleTrigger asChild>
                        <Button {...(!sub && { tooltip: e.label })}>
                            <Icon />
                            <span>{e.label}</span>
                            <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <SidebarMenuSub>
                            {e.items!.length === 0 ? (
                                <SidebarMenuSubItem>
                                    <span className="px-2 text-xs text-muted-foreground">Nothing here yet</span>
                                </SidebarMenuSubItem>
                            ) : (
                                e.items!.map((c) =>
                                    c.items ? (
                                        branch(c, true)
                                    ) : (
                                        <SidebarMenuSubItem key={c.label}>{leaf(c, true)}</SidebarMenuSubItem>
                                    )
                                )
                            )}
                        </SidebarMenuSub>
                    </CollapsibleContent>
                </Item>
            </Collapsible>
        );
    };

    return (
        <>
            {groups.map((g) => (
                <SidebarGroup key={g.title} data-nav-group={g.title}>
                    <SidebarGroupLabel>{g.title}</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {g.items.map((e) =>
                                e.items ? branch(e) : <SidebarMenuItem key={e.label}>{leaf(e)}</SidebarMenuItem>
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            ))}
        </>
    );
}
