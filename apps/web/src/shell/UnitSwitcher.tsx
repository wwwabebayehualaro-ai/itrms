'use client';

/**
 * The unit the person acts for, always visible; a switcher when they hold roles in several units (navigation-and-menus.md
 * §4). Switching changes the scope of every screen: the BFF sends the new unit as X-Org-Unit, the API and RLS scope to
 * it, the menu is computed for it, and nothing cached from the other unit is shown again.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    useNotify
} from '@itrms/ui';
import { NO_LABELS, useAuthStore } from '@/lib/auth/authStore';
import { useText } from '@/lib/preferences';

export function UnitSwitcher() {
    const { t, text } = useText();
    const notify = useNotify();
    const router = useRouter();
    const workspace = useAuthStore((s) => s.workspace);
    const switchUnit = useAuthStore((s) => s.switchUnit);
    const roleLabels = useAuthStore((s) => s.workspace?.roleLabels ?? NO_LABELS);
    const [busy, setBusy] = useState(false);
    if (!workspace) return null;
    const active = workspace.activeUnit;
    const label = text(active.name);

    if (workspace.units.length < 2)
        return (
            <span className="flex items-center gap-2 truncate text-sm font-medium" data-active-unit={active.code}>
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">{t('shell.unit.current', { unit: label })}</span>
                <span className="truncate" aria-hidden>
                    {label}
                </span>
            </span>
        );

    const choose = async (unitId: string) => {
        if (unitId === active.id) return;
        setBusy(true);
        try {
            await switchUnit(unitId);
            const now = useAuthStore.getState().workspace?.activeUnit;
            if (now) notify.success(t('shell.unit.switched', { unit: text(now.name) }));
            // back to the home page: the page open before may not exist, or show other data, in the new unit
            router.push('/');
        } catch {
            notify.error(t('shell.unit.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="max-w-64 gap-2"
                    disabled={busy}
                    aria-label={t('shell.unit.switchFrom', { unit: label })}
                    data-active-unit={active.code}
                >
                    <Building2 className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>{t('shell.unit.switch')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspace.units.map((unit) => (
                    <DropdownMenuItem
                        key={unit.id}
                        onSelect={() => void choose(unit.id)}
                        data-unit={unit.code}
                        aria-current={unit.id === active.id ? 'true' : undefined}
                    >
                        <Check className={unit.id === active.id ? 'opacity-100' : 'opacity-0'} aria-hidden />
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate">{text(unit.name)}</span>
                            <span className="truncate text-xs text-muted-foreground">
                                {unit.roles.map((r) => (roleLabels[r] ? text(roleLabels[r]) : r)).join(', ')}
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
