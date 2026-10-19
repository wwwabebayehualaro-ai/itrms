/**
 * OKLCH maths for the token pipeline: gamut clamping of the generated palette, and WCAG 2 contrast for the contrast test.
 * No DOM and no dependencies, so charts, PDFs and the generator use the same numbers.
 */

export interface Oklch {
    l: number;
    c: number;
    h: number;
    alpha: number;
}

export const oklch = (l: number, c: number, h: number, alpha = 1): Oklch => ({ l, c, h, alpha });

const round = (n: number, digits: number) => Number(n.toFixed(digits));

export function formatOklch({ l, c, h, alpha }: Oklch): string {
    const body = `${round(l, 3)} ${round(c, 3)} ${round(h, 1)}`;
    return alpha < 1 ? `oklch(${body} / ${round(alpha * 100, 1)}%)` : `oklch(${body})`;
}

export function parseOklch(value: string): Oklch {
    const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/.exec(value.trim());
    if (!m) throw new Error(`Not an oklch() colour: ${value}`);
    const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    return oklch(Number(m[1]), Number(m[2]), Number(m[3]), alpha);
}

/** Linear-light sRGB (0..1 when in gamut), from Björn Ottosson's OKLab matrices. */
export function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
    ];
}

const EPS = 1e-6;
export const inSrgbGamut = (color: Oklch) => toLinearSrgb(color).every((v) => v >= -EPS && v <= 1 + EPS);

/** The largest chroma at this lightness and hue that sRGB screens can show (binary search). */
export function maxChroma(l: number, h: number): number {
    let lo = 0;
    let hi = 0.4;
    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (inSrgbGamut(oklch(l, mid, h))) lo = mid;
        else hi = mid;
    }
    return lo;
}

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Gamma-encoded sRGB channels, clamped. Browsers composite alpha in this space. */
const toSrgb = (color: Oklch) => toLinearSrgb(color).map((v) => encode(clamp01(v))) as [number, number, number];

/** WCAG 2 relative luminance of `color` drawn over `backdrop` (only needed when `color` is translucent). */
export function luminance(color: Oklch, backdrop?: Oklch): number {
    let [r, g, b] = toSrgb(color);
    if (color.alpha < 1) {
        const [ur, ug, ub] = backdrop ? toSrgb(backdrop) : [1, 1, 1];
        const mix = (v: number, under: number) => v * color.alpha + under * (1 - color.alpha);
        [r, g, b] = [mix(r, ur), mix(g, ug), mix(b, ub)];
    }
    return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** WCAG 2 contrast ratio (1..21) of a foreground drawn on a background. */
export function contrast(foreground: Oklch, background: Oklch): number {
    const bg = luminance(background);
    const fg = luminance(foreground, background);
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return (hi + 0.05) / (lo + 0.05);
}
