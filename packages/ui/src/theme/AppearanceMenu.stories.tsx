import type { Meta, StoryObj } from '@storybook/react-vite';
import { screen, userEvent, within } from 'storybook/test';

import { TEXT } from '../stories/fixtures';
import { useTexts } from '../stories/locale';
import { DENSITIES, THEMES } from '../tokens/tokens';
import { AppearanceMenu, type AppearanceLabels } from './AppearanceMenu';
import { AppearanceProvider } from './AppearanceProvider';

const meta = {
    title: 'Theme/AppearanceMenu',
    component: AppearanceMenu
} satisfies Meta<typeof AppearanceMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

function MenuDemo() {
    const words = useTexts({
        trigger: TEXT.appearance,
        theme: TEXT.theme,
        density: TEXT.density,
        system: TEXT.themeSystem,
        light: TEXT.themeLight,
        dark: TEXT.themeDark,
        high: TEXT.themeHigh,
        comfortable: TEXT.densityComfortable,
        compact: TEXT.densityCompact
    });
    const labels: AppearanceLabels = {
        trigger: words.trigger,
        theme: words.theme,
        density: words.density,
        themes: { system: words.system, light: words.light, dark: words.dark, 'high-contrast': words.high },
        densities: { comfortable: words.comfortable, compact: words.compact }
    };
    // Start from the look the toolbar (or test mode) already chose, so the provider does not change the page's theme.
    const root = document.documentElement;
    const theme = THEMES.find((t) => root.classList.contains(t)) ?? 'light';
    const density = DENSITIES.find((d) => d === root.dataset.density) ?? 'comfortable';
    return (
        <div className="min-h-72">
            <AppearanceProvider defaultTheme={theme} defaultDensity={density}>
                <AppearanceMenu labels={labels} />
            </AppearanceProvider>
        </div>
    );
}

const openMenu: Story['play'] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
    await screen.findByRole('menu');
};

/** Closed: just the top-bar button. */
export const Default: Story = { render: () => <MenuDemo /> };

/** The play function opens the menu so the choices are part of the accessibility check. */
export const Open: Story = { render: () => <MenuDemo />, play: openMenu };
