'use client';

import { SunMoon } from 'lucide-react';

import { Button } from '../primitives/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '../primitives/dropdown-menu';
import type { Density } from '../tokens/tokens';
import { useAppearance, type ThemePreference } from './AppearanceProvider';

export interface AppearanceLabels {
    trigger: string;
    theme: string;
    density: string;
    themes: Record<ThemePreference, string>;
    densities: Record<Density, string>;
}

// English until the shell's message catalogues arrive (task 0.13); callers pass translated labels.
const ENGLISH: AppearanceLabels = {
    trigger: 'Appearance',
    theme: 'Theme',
    density: 'Density',
    themes: { system: 'System', light: 'Light', dark: 'Dark', 'high-contrast': 'High contrast' },
    densities: { comfortable: 'Comfortable', compact: 'Compact' }
};

const THEME_CHOICES: ThemePreference[] = ['system', 'light', 'dark', 'high-contrast'];
const DENSITY_CHOICES: Density[] = ['comfortable', 'compact'];

export interface AppearanceMenuProps {
    labels?: AppearanceLabels;
    /** the person chose (the app keeps it as their preference, so it follows them to another PC) */
    onChange?: (change: { theme: ThemePreference } | { density: Density }) => void;
}

/** Theme and density choices for the top bar. Changes apply at once, without a reload. */
export function AppearanceMenu({ labels = ENGLISH, onChange }: AppearanceMenuProps) {
    const { theme, setTheme, density, setDensity } = useAppearance();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.trigger} title={labels.trigger}>
                    <SunMoon />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{labels.theme}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(v) => {
                        setTheme(v as ThemePreference);
                        onChange?.({ theme: v as ThemePreference });
                    }}
                >
                    {THEME_CHOICES.map((t) => (
                        <DropdownMenuRadioItem key={t} value={t}>
                            {labels.themes[t]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{labels.density}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={density}
                    onValueChange={(v) => {
                        setDensity(v as Density);
                        onChange?.({ density: v as Density });
                    }}
                >
                    {DENSITY_CHOICES.map((d) => (
                        <DropdownMenuRadioItem key={d} value={d}>
                            {labels.densities[d]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
