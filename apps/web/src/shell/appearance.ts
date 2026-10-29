'use client';
/**
 * The person's look follows them (task 0.21a): the workspace brings their `ui.theme` and `ui.density` as resolved on the
 * server (their own choice, else their office's, else the region's), and the shell applies them; a choice in the
 * appearance menu is kept as their own (`PUT /api/v1/me/settings/:key`), and a choice of the office's value removes theirs
 * (`DELETE`), so a later change of the office's reaches them. The browser still remembers the last look for the first
 * paint.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAppearance, type AppearanceMenuProps } from '@itrms/ui';

import client from '@/lib/api/client';
import { useAuthStore } from '@/lib/auth/authStore';

const THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined => list.find((v) => v === value);

/** Applies the workspace's look whenever it arrives (sign-in, a unit switch); returns what to do on a choice. */
export function usePersonalAppearance(): NonNullable<AppearanceMenuProps['onChange']> {
    const settings = useAuthStore((s) => s.workspace?.settings);
    const office = useAuthStore((s) => s.workspace?.officeSettings);
    const { theme, setTheme, density, setDensity } = useAppearance();
    const wantedTheme = oneOf(THEMES, settings?.['ui.theme']);
    const wantedDensity = oneOf(DENSITIES, settings?.['ui.density']);
    // applied once per value the workspace brings: a choice made since is the person's own and already saved
    const applied = useRef('');
    useEffect(() => {
        const wanted = `${wantedTheme ?? ''}|${wantedDensity ?? ''}`;
        if (applied.current === wanted) return;
        applied.current = wanted;
        if (wantedTheme && wantedTheme !== theme) setTheme(wantedTheme);
        if (wantedDensity && wantedDensity !== density) setDensity(wantedDensity);
    }, [wantedTheme, wantedDensity, theme, density, setTheme, setDensity]);
    return useCallback(
        (change) => {
            const [key, value] = 'theme' in change ? ['ui.theme', change.theme] : ['ui.density', change.density];
            // the look has changed on this page already; a failed save only means it is not kept for the next sign-in
            const saved =
                office?.[key] === value
                    ? client.delete(`v1/me/settings/${key}`)
                    : client.put(`v1/me/settings/${key}`, { value });
            void saved.catch(() => undefined);
        },
        [office]
    );
}
