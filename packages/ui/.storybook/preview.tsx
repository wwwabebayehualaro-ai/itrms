// Every story renders the way the app renders: the theme class and data-density on <html> (ADR-0029), the language in
// <html lang> (the Ethiopic rules key on it), and the providers components expect. The toolbar switches all three.
import './preview.css';

import type { Decorator, Preview } from '@storybook/react-vite';
import { ThemeProvider } from 'next-themes';
import * as React from 'react';

import { TooltipProvider } from '../src/primitives/tooltip';
import { STORY_LOCALES, StoryLocaleProvider, type StoryLocale } from '../src/stories/locale';
import { DENSITIES, THEMES, type Density, type ThemeName } from '../src/tokens/tokens';

/**
 * Set by vitest.stories.config.ts for each test project ("am/dark/compact"), so every story is checked in every theme and
 * density. Undefined in Storybook itself, where the toolbar decides.
 */
declare const __STORY_MODE__: string | undefined;
const mode = typeof __STORY_MODE__ === 'string' ? __STORY_MODE__.split('/') : [];

const isLocale = (v: unknown): v is StoryLocale => STORY_LOCALES.includes(v as StoryLocale);
const isTheme = (v: unknown): v is ThemeName => THEMES.includes(v as ThemeName);
const isDensity = (v: unknown): v is Density => DENSITIES.includes(v as Density);

const withAppearance: Decorator = (Story, context) => {
    const locale = isLocale(context.globals.locale) ? context.globals.locale : 'am';
    const theme = isTheme(context.globals.theme) ? context.globals.theme : 'light';
    const density = isDensity(context.globals.density) ? context.globals.density : 'comfortable';
    // Applied during render (not in an effect) so the first paint, the axe run and the screenshot all see them.
    const root = document.documentElement;
    root.lang = locale;
    root.classList.remove(...THEMES);
    root.classList.add(theme);
    root.dataset.density = density;
    return (
        // next-themes is what the app's components (the toaster) read the theme from. One provider per theme (key and
        // storage key), set to the story's theme, so a stored value from another mode never leaks in.
        <ThemeProvider
            key={theme}
            attribute="class"
            themes={[...THEMES]}
            defaultTheme={theme}
            enableSystem={false}
            storageKey={`storybook-theme-${theme}`}
        >
            <StoryLocaleProvider locale={locale}>
                <TooltipProvider delayDuration={0}>
                    <Story />
                </TooltipProvider>
            </StoryLocaleProvider>
        </ThemeProvider>
    );
};

const preview: Preview = {
    decorators: [withAppearance],
    globalTypes: {
        locale: {
            description: 'Language',
            toolbar: {
                title: 'Language',
                icon: 'globe',
                items: [
                    { value: 'am', title: 'አማርኛ (am)' },
                    { value: 'en', title: 'English (en)' },
                    { value: 'wal-Latn', title: 'Wolaytta (wal-Latn)' }
                ],
                dynamicTitle: true
            }
        },
        theme: {
            description: 'Theme',
            toolbar: {
                title: 'Theme',
                icon: 'contrast',
                items: THEMES.map((t) => ({ value: t, title: t })),
                dynamicTitle: true
            }
        },
        density: {
            description: 'Density',
            toolbar: {
                title: 'Density',
                icon: 'component',
                items: DENSITIES.map((d) => ({ value: d, title: d })),
                dynamicTitle: true
            }
        }
    },
    initialGlobals: {
        locale: isLocale(mode[0]) ? mode[0] : 'am',
        theme: isTheme(mode[1]) ? mode[1] : 'light',
        density: isDensity(mode[2]) ? mode[2] : 'comfortable'
    },
    parameters: {
        layout: 'padded',
        // axe violations fail the story's test (vitest.stories.config.ts), not only the a11y panel.
        a11y: { test: 'error' },
        controls: { expanded: true }
    }
};

export default preview;
