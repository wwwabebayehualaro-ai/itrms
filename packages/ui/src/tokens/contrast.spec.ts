import { describe, expect, it } from 'vitest';

import { contrast, inSrgbGamut, luminance, parseOklch } from './color';
import { CONTRAST_PAIRS, palette, THEMES, themes, tokenColor, type SemanticToken } from './tokens';

describe('colour maths', () => {
    it('matches known WCAG ratios', () => {
        const white = parseOklch('oklch(1 0 0)');
        const black = parseOklch('oklch(0 0 0)');
        expect(contrast(black, white)).toBeCloseTo(21, 1);
        expect(contrast(white, white)).toBeCloseTo(1, 5);
        // #767676 on white is the classic 4.54:1 grey; it is oklch(0.5659 0 0).
        expect(contrast(parseOklch('oklch(0.5659 0 0)'), white)).toBeCloseTo(4.54, 1);
    });

    it('composites a translucent colour over its background', () => {
        const white = parseOklch('oklch(1 0 0)');
        expect(contrast(parseOklch('oklch(0 0 0 / 0%)'), white)).toBeCloseTo(1, 5);
    });
});

describe('palette', () => {
    it('stays inside the sRGB gamut, so every screen shows the colour the contrast test measured', () => {
        const outside = Object.entries(palette).flatMap(([hue, steps]) =>
            Object.entries(steps)
                .filter(([, v]) => !inSrgbGamut(parseOklch(v)))
                .map(([s]) => `${hue}.${s}`)
        );
        expect(outside).toEqual([]);
    });
});

describe('tinted control backgrounds (dark theme)', () => {
    // Outline buttons and select/combobox triggers draw --input at an opacity over the page in the dark theme, and
    // brighter on hover (dark:bg-input/30, dark:hover:bg-input/35). Their placeholder text is muted-foreground: it must
    // keep 4.5:1 on the hover tint too. At 50 % it fell to 3.6:1 (found by axe in a Linux run).
    it.each([0.3, 0.35])('muted text keeps 4.5:1 on --input at %s over the background', (alpha) => {
        const tint = { ...tokenColor('dark', 'input'), alpha };
        const background = luminance(tint, tokenColor('dark', 'background'));
        const text = luminance(tokenColor('dark', 'muted-foreground'));
        expect((Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
});

describe.each(THEMES)('contrast in the %s theme', (theme) => {
    it('meets WCAG AA: 4.5:1 for text, 3:1 for UI parts', () => {
        const failures = CONTRAST_PAIRS.map(({ fg, bg, min }) => ({
            pair: `${fg} on ${bg}`,
            ratio: Number(contrast(tokenColor(theme, fg), tokenColor(theme, bg)).toFixed(2)),
            min
        })).filter((r) => r.ratio < r.min);
        expect(failures).toEqual([]);
    });

    it.runIf(theme === 'high-contrast')('reaches WCAG AAA (7:1) for every text pair', () => {
        const failures = CONTRAST_PAIRS.filter((p) => p.min === 4.5)
            .map(({ fg, bg }) => ({
                pair: `${fg} on ${bg}`,
                ratio: contrast(tokenColor(theme, fg), tokenColor(theme, bg))
            }))
            .filter((r) => r.ratio < 7);
        expect(failures).toEqual([]);
    });

    it('defines every semantic token, inside the sRGB gamut', () => {
        const tokens = Object.keys(themes.light) as SemanticToken[];
        expect(tokens.filter((t) => !themes[theme][t])).toEqual([]);
        expect(tokens.filter((t) => !inSrgbGamut(tokenColor(theme, t)))).toEqual([]);
    });
});
