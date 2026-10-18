/**
 * Width of a field that takes `span` of 12 columns in a wrapping row (the parent must be a flex row with `gap: var(--fe-gap, 1rem)`):
 * the usual column maths, minus this field's share of the gaps. A full-width field (span 12) needs no width.
 */
export const spanWidth = (span: number) => `calc(${((span / 12) * 100).toFixed(4)}% - var(--fe-gap, 1rem) * ${((12 - span) / 12).toFixed(4)})`;

export const validSpan = (value: unknown): number | undefined => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n < 12 ? n : undefined;
};
