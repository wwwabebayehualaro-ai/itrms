import type { Meta, StoryObj } from '@storybook/react-vite';
import { ClipboardList, Gauge, LineChart } from 'lucide-react';

import { TEXT } from '../stories/fixtures';
import { T, useText } from '../stories/locale';
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
    SidebarProvider,
    SidebarTrigger
} from './sidebar';

const meta = {
    title: 'Primitives/Sidebar',
    component: Sidebar,
    parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const ITEMS = [
    { text: TEXT.dashboard, icon: Gauge },
    { text: TEXT.applications, icon: ClipboardList },
    { text: TEXT.reports, icon: LineChart }
] as const;

function Menu({ active }: { active?: number }) {
    return (
        <SidebarMenu>
            {ITEMS.map(({ text, icon: Icon }, i) => (
                <SidebarMenuItem key={i}>
                    <SidebarMenuButton isActive={i === active}>
                        <Icon aria-hidden="true" />
                        <span>
                            <T text={text} />
                        </span>
                    </SidebarMenuButton>
                    {i === 1 && <SidebarMenuBadge>12</SidebarMenuBadge>}
                </SidebarMenuItem>
            ))}
        </SidebarMenu>
    );
}

/** The sidebar inside a provider, with a trigger in the page area. */
function LayoutDemo({ collapsible = 'offcanvas' }: { collapsible?: 'offcanvas' | 'icon' | 'none' }) {
    const toggle = useText(TEXT.toggleSidebar);
    return (
        <SidebarProvider className="min-h-96">
            <Sidebar collapsible={collapsible} aria-label={useText(TEXT.menu)}>
                <SidebarHeader>
                    <T text={TEXT.menu} />
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>
                            <T text={TEXT.applications} />
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <Menu active={0} />
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
            </Sidebar>
            <SidebarInset>
                <header className="flex items-center gap-2 p-2">
                    <SidebarTrigger aria-label={toggle} />
                    <T text={TEXT.dashboard} />
                </header>
            </SidebarInset>
        </SidebarProvider>
    );
}

export const Default: Story = { render: () => <LayoutDemo /> };

/** Collapsed to icons; the labels move into tooltips. */
export const IconOnly: Story = { render: () => <LayoutDemo collapsible="icon" /> };

/** Rows shown while the menu loads. */
export const Loading: Story = {
    render: () => (
        <SidebarProvider className="min-h-48">
            <Sidebar collapsible="none">
                <SidebarContent>
                    <SidebarMenu>
                        {[0, 1, 2].map((i) => (
                            <SidebarMenuItem key={i}>
                                <SidebarMenuSkeleton showIcon />
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                </SidebarContent>
            </Sidebar>
        </SidebarProvider>
    )
};
