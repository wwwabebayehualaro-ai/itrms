/**
 * Design tokens in three tiers (ADR-0029, docs/platform/design-system.md §3). This file is the source: `pnpm --filter
 * @itrms/ui tokens` writes src/styles/tokens.css from it, a test fails when the CSS is stale, and charts and PDFs read the
 * same values through `resolveToken`.
 *
 *   primitive  the palette: hue ramps generated in OKLCH and clamped to the sRGB gamut (design-system owners only)
 *   semantic   meaning, per theme: light, dark, high contrast (components read only these)
 *   component  sizes per density: comfortable, compact
 */
import { formatOklch, maxChroma, oklch, parseOklch, type Oklch } from './color';

// ---- primitive tier --------------------------------------------------------------------------------------------------

/** Lightness of each step. 900 and 950 are dark enough for the dark theme's surfaces. */
export const STEPS = {
    50: 0.985,
    100: 0.967,
    200: 0.925,
    300: 0.869,
    400: 0.76,
    500: 0.645,
    600: 0.53,
    700: 0.46,
    800: 0.385,
    900: 0.285,
    950: 0.21
} as const;
export type Step = keyof typeof STEPS;

/**
 * Hue and peak chroma of each ramp. `brand` is the product's deep teal-blue; tenant branding will swap its hue for one of
 * the pre-validated hues. The Ethiopian flag colours are deliberately not UI colours (they clash with the status tones).
 */
export const HUES = {
    slate: { h: 257, c: 0.035 },
    grey: { h: 260, c: 0.008 },
    brand: { h: 222, c: 0.12 },
    blue: { h: 255, c: 0.17 },
    indigo: { h: 277, c: 0.19 },
    green: { h: 150, c: 0.16 },
    amber: { h: 72, c: 0.17 },
    red: { h: 26, c: 0.21 }
} as const;
export type Hue = keyof typeof HUES;

/** Light tints carry little chroma; the rest take the hue's peak, clamped to what sRGB can show. */
function step(hue: Hue, s: Step): Oklch {
    const { h, c } = HUES[hue];
    const l = STEPS[s];
    const tint = Math.min(1, (1 - l) * 4);
    // Rounded down: formatOklch keeps 3 decimals, and rounding up could leave the gamut.
    return oklch(l, Math.floor(Math.min(c * tint, maxChroma(l, h) * 0.98) * 1000) / 1000, h);
}

export const palette = Object.fromEntries(
    (Object.keys(HUES) as Hue[]).map((hue) => [
        hue,
        Object.fromEntries((Object.keys(STEPS) as unknown as Step[]).map((s) => [s, formatOklch(step(hue, s))]))
    ])
) as Record<Hue, Record<Step, string>>;

/** A reference to a palette step, written `slate.600`; or a literal oklch() colour. */
export type ColorRef = `${Hue}.${Step}` | `oklch(${string})`;

// ---- semantic tier ---------------------------------------------------------------------------------------------------

export const THEMES = ['light', 'dark', 'high-contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

export const TONES = ['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'muted'] as const;
export type StatusTone = (typeof TONES)[number];

/** Per tone: the solid colour (icon, border, dot), a soft fill and the text drawn on that fill. */
type StatusTokens = { [T in StatusTone as `status-${T}` | `status-${T}-bg` | `status-${T}-fg`]: ColorRef };

export type SemanticTokens = {
    background: ColorRef;
    foreground: ColorRef;
    card: ColorRef;
    'card-foreground': ColorRef;
    popover: ColorRef;
    'popover-foreground': ColorRef;
    primary: ColorRef;
    'primary-foreground': ColorRef;
    secondary: ColorRef;
    'secondary-foreground': ColorRef;
    muted: ColorRef;
    'muted-foreground': ColorRef;
    accent: ColorRef;
    'accent-foreground': ColorRef;
    destructive: ColorRef;
    'destructive-foreground': ColorRef;
    success: ColorRef;
    'success-foreground': ColorRef;
    warning: ColorRef;
    'warning-foreground': ColorRef;
    info: ColorRef;
    'info-foreground': ColorRef;
    /** Decorative separators only; form-field outlines use `input`. */
    border: ColorRef;
    input: ColorRef;
    ring: ColorRef;
    /** Behind dialogs and sheets. */
    overlay: ColorRef;
    sidebar: ColorRef;
    'sidebar-foreground': ColorRef;
    'sidebar-primary': ColorRef;
    'sidebar-primary-foreground': ColorRef;
    'sidebar-accent': ColorRef;
    'sidebar-accent-foreground': ColorRef;
    'sidebar-border': ColorRef;
    'sidebar-ring': ColorRef;
} & StatusTokens & { [N in 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 as `chart-${N}`]: ColorRef };
export type SemanticToken = keyof SemanticTokens;

/** Eight categorical series hues, ordered so neighbours differ in hue and lightness. */
const CHART_HUES = [255, 160, 70, 25, 300, 195, 350, 45];
const chart = (l: number, c: number) =>
    Object.fromEntries(
        CHART_HUES.map((h, i) => [`chart-${i + 1}`, formatOklch(oklch(l, Math.min(c, maxChroma(l, h) * 0.98), h))])
    ) as { [K in `chart-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`]: ColorRef };

const light: SemanticTokens = {
    background: 'oklch(1 0 0)',
    foreground: 'slate.950',
    card: 'oklch(1 0 0)',
    'card-foreground': 'slate.950',
    popover: 'oklch(1 0 0)',
    'popover-foreground': 'slate.950',
    primary: 'brand.700',
    'primary-foreground': 'oklch(1 0 0)',
    secondary: 'slate.100',
    'secondary-foreground': 'slate.900',
    muted: 'slate.100',
    'muted-foreground': 'slate.600',
    accent: 'brand.50',
    'accent-foreground': 'brand.800',
    destructive: 'red.600',
    'destructive-foreground': 'oklch(1 0 0)',
    success: 'green.700',
    'success-foreground': 'oklch(1 0 0)',
    warning: 'amber.400',
    'warning-foreground': 'amber.950',
    info: 'blue.600',
    'info-foreground': 'oklch(1 0 0)',
    border: 'slate.200',
    input: 'slate.500',
    ring: 'brand.600',
    overlay: 'oklch(0.21 0.02 257 / 50%)',
    sidebar: 'slate.50',
    'sidebar-foreground': 'slate.800',
    'sidebar-primary': 'brand.700',
    'sidebar-primary-foreground': 'oklch(1 0 0)',
    'sidebar-accent': 'slate.200',
    'sidebar-accent-foreground': 'slate.950',
    'sidebar-border': 'slate.200',
    'sidebar-ring': 'brand.600',
    'status-neutral': 'slate.600',
    'status-neutral-bg': 'slate.100',
    'status-neutral-fg': 'slate.800',
    'status-info': 'blue.600',
    'status-info-bg': 'blue.50',
    'status-info-fg': 'blue.800',
    'status-progress': 'indigo.600',
    'status-progress-bg': 'indigo.50',
    'status-progress-fg': 'indigo.800',
    'status-success': 'green.600',
    'status-success-bg': 'green.50',
    'status-success-fg': 'green.800',
    'status-warning': 'amber.600',
    'status-warning-bg': 'amber.50',
    'status-warning-fg': 'amber.800',
    'status-danger': 'red.600',
    'status-danger-bg': 'red.50',
    'status-danger-fg': 'red.800',
    'status-muted': 'grey.600',
    'status-muted-bg': 'grey.100',
    'status-muted-fg': 'grey.700',
    ...chart(0.57, 0.15)
};

const dark: SemanticTokens = {
    background: 'slate.950',
    foreground: 'slate.50',
    card: 'slate.900',
    'card-foreground': 'slate.50',
    popover: 'slate.900',
    'popover-foreground': 'slate.50',
    primary: 'brand.400',
    'primary-foreground': 'brand.950',
    secondary: 'slate.800',
    'secondary-foreground': 'slate.50',
    muted: 'slate.800',
    'muted-foreground': 'slate.400',
    accent: 'brand.900',
    'accent-foreground': 'brand.100',
    destructive: 'red.400',
    'destructive-foreground': 'red.950',
    success: 'green.400',
    'success-foreground': 'green.950',
    warning: 'amber.400',
    'warning-foreground': 'amber.950',
    info: 'blue.400',
    'info-foreground': 'blue.950',
    border: 'slate.800',
    input: 'slate.500',
    ring: 'brand.400',
    overlay: 'oklch(0 0 0 / 60%)',
    sidebar: 'slate.950',
    'sidebar-foreground': 'slate.200',
    'sidebar-primary': 'brand.400',
    'sidebar-primary-foreground': 'brand.950',
    'sidebar-accent': 'slate.800',
    'sidebar-accent-foreground': 'slate.50',
    'sidebar-border': 'slate.800',
    'sidebar-ring': 'brand.400',
    'status-neutral': 'slate.400',
    'status-neutral-bg': 'slate.800',
    'status-neutral-fg': 'slate.100',
    'status-info': 'blue.400',
    'status-info-bg': 'blue.950',
    'status-info-fg': 'blue.200',
    'status-progress': 'indigo.400',
    'status-progress-bg': 'indigo.950',
    'status-progress-fg': 'indigo.200',
    'status-success': 'green.400',
    'status-success-bg': 'green.950',
    'status-success-fg': 'green.200',
    'status-warning': 'amber.400',
    'status-warning-bg': 'amber.950',
    'status-warning-fg': 'amber.200',
    'status-danger': 'red.400',
    'status-danger-bg': 'red.950',
    'status-danger-fg': 'red.200',
    'status-muted': 'grey.500',
    'status-muted-bg': 'grey.900',
    'status-muted-fg': 'grey.300',
    ...chart(0.72, 0.14)
};

/** For bright offices and low vision: near-black text, solid outlines, darker status colours, no faint greys. */
const highContrast: SemanticTokens = {
    ...light,
    foreground: 'oklch(0.15 0 0)',
    'card-foreground': 'oklch(0.15 0 0)',
    'popover-foreground': 'oklch(0.15 0 0)',
    primary: 'brand.800',
    'secondary-foreground': 'oklch(0.15 0 0)',
    'muted-foreground': 'slate.800',
    'accent-foreground': 'brand.900',
    destructive: 'red.700',
    success: 'green.800',
    warning: 'amber.700',
    'warning-foreground': 'oklch(1 0 0)',
    info: 'blue.700',
    border: 'slate.600',
    input: 'slate.800',
    ring: 'oklch(0.15 0 0)',
    overlay: 'oklch(0 0 0 / 70%)',
    'sidebar-foreground': 'oklch(0.15 0 0)',
    'sidebar-primary': 'brand.800',
    'sidebar-border': 'slate.600',
    'sidebar-ring': 'oklch(0.15 0 0)',
    'status-neutral': 'slate.800',
    'status-neutral-fg': 'slate.950',
    'status-info': 'blue.700',
    'status-info-fg': 'blue.900',
    'status-progress': 'indigo.700',
    'status-progress-fg': 'indigo.900',
    'status-success': 'green.700',
    'status-success-fg': 'green.900',
    'status-warning': 'amber.700',
    'status-warning-fg': 'amber.900',
    'status-danger': 'red.700',
    'status-danger-fg': 'red.900',
    'status-muted': 'grey.700',
    'status-muted-fg': 'grey.900',
    ...chart(0.5, 0.15)
};

export const themes: Record<ThemeName, SemanticTokens> = { light, dark, 'high-contrast': highContrast };

/** The colour a reference stands for, as an oklch() string (for charts, PDFs and the contrast test). */
export function resolveColor(ref: ColorRef): string {
    if (ref.startsWith('oklch(')) return ref;
    const [hue, s] = ref.split('.') as [Hue, `${Step}`];
    return palette[hue][Number(s) as Step];
}

export const resolveToken = (theme: ThemeName, token: SemanticToken): string => resolveColor(themes[theme][token]);
export const tokenColor = (theme: ThemeName, token: SemanticToken): Oklch => parseOklch(resolveToken(theme, token));

/**
 * The pairs the contrast test checks in every theme. Text pairs need 4.5:1 (WCAG 1.4.3); UI parts, meaning form-field
 * outlines, focus rings, status icons and chart marks, need 3:1 against what they sit on (WCAG 1.4.11).
 */
export const CONTRAST_PAIRS: { fg: SemanticToken; bg: SemanticToken; min: 4.5 | 3 }[] = [
    ...(
        [
            ['foreground', 'background'],
            ['card-foreground', 'card'],
            ['popover-foreground', 'popover'],
            ['primary-foreground', 'primary'],
            ['secondary-foreground', 'secondary'],
            ['muted-foreground', 'background'],
            ['muted-foreground', 'muted'],
            ['muted-foreground', 'card'],
            ['accent-foreground', 'accent'],
            ['destructive', 'background'],
            ['destructive', 'card'],
            ['destructive-foreground', 'destructive'],
            ['success-foreground', 'success'],
            ['warning-foreground', 'warning'],
            ['info-foreground', 'info'],
            ['primary', 'background'],
            ['success', 'background'],
            ['sidebar-foreground', 'sidebar'],
            ['sidebar-primary-foreground', 'sidebar-primary'],
            ['sidebar-accent-foreground', 'sidebar-accent'],
            ...TONES.map((t) => [`status-${t}-fg`, `status-${t}-bg`])
        ] as [SemanticToken, SemanticToken][]
    ).map(([fg, bg]) => ({ fg, bg, min: 4.5 as const })),
    ...(
        [
            ['input', 'background'],
            ['input', 'card'],
            ['ring', 'background'],
            ['ring', 'card'],
            ['sidebar-ring', 'sidebar'],
            ...TONES.map((t) => [`status-${t}`, `status-${t}-bg`]),
            ...TONES.map((t) => [`status-${t}`, 'background']),
            ...TONES.map((t) => [`status-${t}`, 'card']),
            ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`chart-${n}`, 'background'])
        ] as [SemanticToken, SemanticToken][]
    ).map(([fg, bg]) => ({ fg, bg, min: 3 as const }))
];

// ---- component tier --------------------------------------------------------------------------------------------------

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export type ComponentTokens = {
    'field-height': string;
    'field-height-sm': string;
    'table-row-height': string;
    'table-cell-px': string;
    'page-gutter': string;
    'form-gap': string;
};

export const densities: Record<Density, ComponentTokens> = {
    comfortable: {
        'field-height': '2.5rem',
        'field-height-sm': '2.125rem',
        'table-row-height': '2.75rem',
        'table-cell-px': '0.75rem',
        'page-gutter': '1.5rem',
        'form-gap': '1.25rem'
    },
    // Data-entry staff: 32 px rows and tighter forms (design-system.md §4).
    compact: {
        'field-height': '2rem',
        'field-height-sm': '1.75rem',
        'table-row-height': '2rem',
        'table-cell-px': '0.5rem',
        'page-gutter': '1rem',
        'form-gap': '0.75rem'
    }
};

/** On touch screens controls stay at least 44 px tall in either density (design-system.md §10). */
export const touch: Partial<ComponentTokens> = {
    'field-height': '2.75rem',
    'field-height-sm': '2.75rem',
    'table-row-height': '2.75rem'
};

export const radius = '0.5rem';

// ---- typography ------------------------------------------------------------------------------------------------------

/**
 * Noto Sans comes first: it covers Latin (English, Wolaytta) and has no Ethiopic glyphs, so Ethiopic characters fall
 * through to Noto Sans Ethiopic in the same run of text ("ቦሎ No. WLT/000123"). Both are self-hosted (fonts.css).
 */
export const fonts = {
    sans: "'Noto Sans Variable', 'Noto Sans Ethiopic Variable', system-ui, sans-serif",
    mono: "'Noto Sans Mono Variable', 'Noto Sans Ethiopic Variable', ui-monospace, monospace"
} as const;

/** Languages written in Ethiopic script get the taller line heights and the 14 px floor (design-system.md §5). */
export const ETHIOPIC_LANGUAGES = ['am', 'ti', 'gez'] as const;

export const typography = {
    baseSize: '16px',
    minEthiopicSize: '0.875rem',
    bodyLineHeight: 1.6,
    headingLineHeight: 1.3
} as const;
