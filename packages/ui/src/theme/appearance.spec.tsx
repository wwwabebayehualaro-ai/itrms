import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { AppearanceProvider, useAppearance } from './AppearanceProvider';

function Probe() {
    const { resolvedTheme, setTheme, density, setDensity } = useAppearance();
    return (
        <div>
            <output data-testid="theme">{resolvedTheme}</output>
            <output data-testid="density">{density}</output>
            <button onClick={() => setTheme('dark')}>dark</button>
            <button onClick={() => setTheme('high-contrast')}>high contrast</button>
            <button onClick={() => setTheme('light')}>light</button>
            <button onClick={() => setDensity('compact')}>compact</button>
            <button onClick={() => setDensity('comfortable')}>comfortable</button>
        </div>
    );
}

const html = () => document.documentElement;

afterEach(() => {
    localStorage.clear();
    html().className = '';
    delete html().dataset.density;
});

describe('appearance', () => {
    it('switches the three themes at runtime, one class on <html> at a time', async () => {
        render(
            <AppearanceProvider>
                <Probe />
            </AppearanceProvider>
        );
        const user = userEvent.setup();

        await user.click(screen.getByText('dark'));
        expect(html().classList.contains('dark')).toBe(true);
        expect(screen.getByTestId('theme')).toHaveTextContent('dark');

        await user.click(screen.getByText('high contrast'));
        expect(html().classList.contains('high-contrast')).toBe(true);
        expect(html().classList.contains('dark')).toBe(false);

        await user.click(screen.getByText('light'));
        expect(html().classList.contains('light')).toBe(true);
        expect(html().classList.contains('high-contrast')).toBe(false);
    });

    it('switches density at runtime and remembers it', async () => {
        render(
            <AppearanceProvider>
                <Probe />
            </AppearanceProvider>
        );
        expect(html().dataset.density).toBe('comfortable');

        await userEvent.setup().click(screen.getByText('compact'));
        expect(html().dataset.density).toBe('compact');
        expect(localStorage.getItem('itrms.density')).toBe('compact');
    });

    it('starts from the remembered density', async () => {
        localStorage.setItem('itrms.density', 'compact');
        render(
            <AppearanceProvider>
                <Probe />
            </AppearanceProvider>
        );
        await act(() => Promise.resolve());
        expect(screen.getByTestId('density')).toHaveTextContent('compact');
        expect(html().dataset.density).toBe('compact');
    });

    it('ignores a stored value it does not know', async () => {
        localStorage.setItem('itrms.density', '"><script>');
        render(
            <AppearanceProvider defaultDensity="compact">
                <Probe />
            </AppearanceProvider>
        );
        await act(() => Promise.resolve());
        expect(html().dataset.density).toBe('compact');
    });
});
