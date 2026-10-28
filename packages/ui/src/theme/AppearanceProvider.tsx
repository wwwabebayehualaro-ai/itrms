'use client';

import * as React from 'react';
import { ThemeProvider, useTheme } from 'next-themes';

import { DENSITIES, THEMES, type Density, type ThemeName } from '../tokens/tokens';

/** The `ui.theme` preference: a theme, or follow the operating system (light or dark). */
export type ThemePreference = ThemeName | 'system';

const DENSITY_KEY = 'itrms.density';

const DensityContext = React.createContext<{ density: Density; setDensity: (d: Density) => void } | null>(null);

const isDensity = (v: unknown): v is Density => DENSITIES.includes(v as Density);

/**
 * The chosen density lives in localStorage, read through useSyncExternalStore: the server and the first client render use
 * the default (so hydration matches), and other tabs follow a change through the `storage` event. When storage is blocked
 * (private mode, policy) the choice is kept in memory for this page.
 */
const densityListeners = new Set<() => void>();
let unstoredDensity: Density | null = null;

function readDensity(): Density | null {
    try {
        const v = window.localStorage.getItem(DENSITY_KEY);
        return isDensity(v) ? v : unstoredDensity;
    } catch {
        return unstoredDensity;
    }
}

function writeDensity(d: Density) {
    try {
        window.localStorage.setItem(DENSITY_KEY, d);
        unstoredDensity = null;
    } catch {
        unstoredDensity = d;
    }
    densityListeners.forEach((l) => l());
}

function subscribeDensity(listener: () => void) {
    const onStorage = (e: StorageEvent) => {
        if (e.key === DENSITY_KEY) listener();
    };
    densityListeners.add(listener);
    window.addEventListener('storage', onStorage);
    return () => {
        densityListeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Sets `data-density` on <html> before the first paint, as next-themes does for the theme class, so a compact user never
 * sees a comfortable flash. The script only reads one known key and writes one of two known values.
 */
const densityScript = (requested: Density) => {
    // Only the two known values ever reach the script text, whatever a caller passes at runtime.
    const fallback: Density = isDensity(requested) ? requested : 'comfortable';
    return (
        `try{var d=localStorage.getItem(${JSON.stringify(DENSITY_KEY)});document.documentElement.dataset.density=` +
        `(d==='compact'||d==='comfortable')?d:${JSON.stringify(fallback)}}catch(e){document.documentElement.dataset.density=${JSON.stringify(fallback)}}`
    );
};

export interface AppearanceProviderProps {
    children: React.ReactNode;
    /** Defaults before the app knows the person's `ui.theme` and `ui.density` (it applies them with useAppearance). */
    defaultTheme?: ThemePreference;
    defaultDensity?: Density;
    /** CSP nonce for the two inline pre-paint scripts. */
    nonce?: string;
}

/**
 * Theme (light, dark, high contrast, or system) as a class on <html>, and density as `data-density` on <html>. Both switch at
 * runtime without a reload and are remembered per browser, for the first paint; the app keeps the person's choice on the
 * server and applies it when it arrives.
 */
export function AppearanceProvider({
    children,
    defaultTheme = 'light',
    defaultDensity = 'comfortable',
    nonce
}: AppearanceProviderProps) {
    const density = React.useSyncExternalStore(
        subscribeDensity,
        () => readDensity() ?? defaultDensity,
        () => defaultDensity
    );

    React.useEffect(() => {
        document.documentElement.dataset.density = density;
    }, [density]);

    const setDensity = React.useCallback((d: Density) => writeDensity(d), []);

    const value = React.useMemo(() => ({ density, setDensity }), [density, setDensity]);

    return (
        <ThemeProvider
            attribute="class"
            themes={[...THEMES]}
            defaultTheme={defaultTheme}
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
        >
            <script
                nonce={nonce}
                suppressHydrationWarning
                dangerouslySetInnerHTML={{ __html: densityScript(defaultDensity) }}
            />
            <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
        </ThemeProvider>
    );
}

export interface Appearance {
    /** The preference as chosen, including 'system'. */
    theme: ThemePreference;
    /** The theme actually shown. */
    resolvedTheme: ThemeName;
    setTheme: (theme: ThemePreference) => void;
    density: Density;
    setDensity: (density: Density) => void;
}

export function useAppearance(): Appearance {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const density = React.useContext(DensityContext);
    if (!density) throw new Error('useAppearance must be used inside <AppearanceProvider>');
    const shown = THEMES.includes(resolvedTheme as ThemeName) ? (resolvedTheme as ThemeName) : 'light';
    return {
        theme: (theme as ThemePreference | undefined) ?? 'system',
        resolvedTheme: shown,
        setTheme,
        ...density
    };
}
