'use client';

/**
 * The command palette (Ctrl+K or Cmd+K; navigation-and-menus.md §4): one box for the pages and the quick actions of the
 * person's menu here, with their recently opened pages first. Record search joins it with the registers (task 0.14).
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Zap } from 'lucide-react';
import {
    Button,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut
} from '@itrms/ui';
import { useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';
import { useShortcuts } from '@/lib/shortcuts';
import { MENU_ICONS } from './menu-icons.generated';

export function CommandPalette() {
    const { t, text } = useText();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const menu = useAuthStore((s) => s.workspace?.menu);
    const recents = useShortcuts((s) => s.recents);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setOpen((o) => !o);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const items = useMemo(() => (menu ?? []).flatMap((g) => g.items), [menu]);
    const recent = recents.flatMap((r) => items.filter((i) => i.key === r.key)).slice(0, 5);
    const actions = items.flatMap((i) => i.quickActions);
    const go = (route: string) => {
        setOpen(false);
        router.push(route);
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-9 justify-start gap-2 text-muted-foreground sm:w-56"
                onClick={() => setOpen(true)}
                aria-label={t('shell.search.open')}
                aria-keyshortcuts="Control+K Meta+K"
            >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="hidden truncate sm:inline">{t('shell.search.open')}</span>
                <kbd className="ml-auto hidden rounded border px-1 text-[10px] sm:inline">
                    {t('shell.search.shortcut')}
                </kbd>
            </Button>
            <CommandDialog
                open={open}
                onOpenChange={setOpen}
                title={t('shell.search.open')}
                description={t('shell.search.placeholder')}
            >
                <CommandInput placeholder={t('shell.search.placeholder')} />
                <CommandList>
                    <CommandEmpty>{t('shell.search.empty')}</CommandEmpty>
                    {recent.length > 0 && (
                        <CommandGroup heading={t('shell.search.recent')}>
                            {recent.map((i) => (
                                <CommandItem
                                    key={`recent:${i.key}`}
                                    value={`recent ${text(i.label)}`}
                                    onSelect={() => go(i.route)}
                                >
                                    {(() => {
                                        const Icon = MENU_ICONS[i.icon] ?? MENU_ICONS.circle;
                                        return Icon ? <Icon /> : null;
                                    })()}
                                    {text(i.label)}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                    <CommandGroup heading={t('shell.search.pages')}>
                        {items.map((i) => {
                            const Icon = MENU_ICONS[i.icon] ?? MENU_ICONS.circle;
                            return (
                                <CommandItem
                                    key={i.key}
                                    value={`${text(i.label)} ${i.label.en}`}
                                    onSelect={() => go(i.route)}
                                >
                                    {Icon && <Icon />}
                                    {text(i.label)}
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                    {actions.length > 0 && (
                        <CommandGroup heading={t('shell.search.actions')}>
                            {actions.map((a) => (
                                <CommandItem
                                    key={a.key}
                                    value={`${text(a.label)} ${a.label.en}`}
                                    onSelect={() => go(a.route)}
                                >
                                    <Zap />
                                    {text(a.label)}
                                    <CommandShortcut>↵</CommandShortcut>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
            </CommandDialog>
        </>
    );
}
