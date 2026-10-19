/**
 * Renders tokens.ts as src/styles/tokens.css. Run `pnpm --filter @itrms/ui tokens` after changing a token; the test in
 * css.spec.ts fails while the CSS file is stale.
 */
import {
    densities,
    ETHIOPIC_LANGUAGES,
    fonts,
    palette,
    radius,
    themes,
    touch,
    typography,
    type ColorRef,
    type ComponentTokens,
    type SemanticTokens
} from './tokens';

const SELECTORS = { light: ':root', dark: '.dark', 'high-contrast': '.high-contrast' } as const;

const ref = (value: ColorRef) => (value.startsWith('oklch(') ? value : `var(--${value.replace('.', '-')})`);
const block = (selector: string, lines: string[], indent = '') =>
    `${indent}${selector} {\n${lines.map((l) => `${indent}    ${l}`).join('\n')}\n${indent}}`;
const semantic = (tokens: SemanticTokens) => Object.entries(tokens).map(([k, v]) => `--${k}: ${ref(v)};`);
const component = (tokens: Partial<ComponentTokens>) => Object.entries(tokens).map(([k, v]) => `--${k}: ${v};`);

export function renderTokensCss(): string {
    const primitive = Object.entries(palette).flatMap(([hue, steps]) =>
        Object.entries(steps).map(([s, v]) => `--${hue}-${s}: ${v};`)
    );
    const ethiopic = ETHIOPIC_LANGUAGES.map((l) => `:root:lang(${l})`).join(', ');
    const { bodyLineHeight: body, headingLineHeight: heading } = typography;
    return [
        '/* Generated from src/tokens/tokens.ts by `pnpm --filter @itrms/ui tokens`. Do not edit by hand. */',
        '',
        '/* Primitive tier: the palette. Components never read these. */',
        block(':root', [...primitive, `--radius: ${radius};`]),
        '',
        '/* Semantic tier, per theme. */',
        ...Object.entries(themes).map(([name, tokens]) =>
            block(SELECTORS[name as keyof typeof SELECTORS], semantic(tokens))
        ),
        '',
        '/* Component tier, per density; touch screens keep 44 px targets. */',
        block(":root, [data-density='comfortable']", component(densities.comfortable)),
        block("[data-density='compact']", component(densities.compact)),
        block('@media (pointer: coarse)', [
            block(":root, [data-density='compact']", component(touch), '').replaceAll('\n', '\n    ')
        ]),
        '',
        '/* Ethiopic script: never below 14 px, taller lines (body 1.6, headings 1.3). */',
        block(ethiopic, [
            `--text-xs: ${typography.minEthiopicSize};`,
            ...['xs', 'sm', 'base', 'lg'].map((s) => `--text-${s}--line-height: ${body};`),
            ...['xl', '2xl', '3xl', '4xl', '5xl'].map((s) => `--text-${s}--line-height: ${heading};`)
        ]),
        '',
        '/* Tailwind utilities for the semantic tokens; the default palette is switched off so only these exist. */',
        block('@theme inline', [
            '--color-*: initial;',
            ...Object.keys(themes.light).map((k) => `--color-${k}: var(--${k});`),
            `--font-sans: ${fonts.sans};`,
            `--font-mono: ${fonts.mono};`,
            '--radius-sm: calc(var(--radius) * 0.6);',
            '--radius-md: calc(var(--radius) * 0.8);',
            '--radius-lg: var(--radius);',
            '--radius-xl: calc(var(--radius) * 1.4);'
        ]),
        ''
    ].join('\n');
}
