/**
 * Design-system rules that are properties of the source (ADR-0029, design-system.md §3 and §5): components read only
 * semantic tokens, Ethiopic text is never cased, spaced or slanted, labels and titles can wrap, and the fonts come from the
 * app itself. Layout in a real browser (line boxes, two-line labels) is checked by the visual tests of task 0.4a.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'tokens' ? [] : sources(p);
        return /\.tsx?$/.test(e.name) && !/\.spec\.tsx?$/.test(e.name) ? [p] : [];
    });
}
const files = sources(SRC).map((p) => ({
    path: relative(SRC, p).replaceAll('\\', '/'),
    text: readFileSync(p, 'utf8')
}));

const matches = (re: RegExp) =>
    files.flatMap(({ path, text }) => [...text.matchAll(re)].map((m) => `${path}: ${m[0]}`));

const PALETTE =
    'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white';

describe('components read only semantic tokens', () => {
    it('use no palette utilities (bg-red-500, text-white, …)', () => {
        const re = new RegExp(
            `\\b(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|from|to|via|outline|divide|shadow|decoration|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?\\b`,
            'g'
        );
        expect(matches(re)).toEqual([]);
    });

    it('use no literal colours', () => {
        expect(matches(/#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:oklch|rgba?|hsla?)\(/g)).toEqual([]);
    });

    // The contrast test measures tokens at full strength; a translucent copy on top of a surface is a colour it never saw.
    it('draw text and focus rings at full strength (no text-x/50, ring-ring/50)', () => {
        // An invalid field's soft halo is decoration: the solid destructive border and the error text carry the state.
        const translucent = matches(
            /(?<=["'`\s])[\w:[\]&>*=-]*?(?:text|ring|outline)-(?!transparent\b)[a-z-]+\/\d+\b/g
        );
        expect(translucent.filter((m) => !/\baria-invalid:/.test(m))).toEqual([]);
    });

    it('switch the Tailwind default palette off, so a raw colour utility produces no CSS at all', () => {
        expect(readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')).toContain('--color-*: initial;');
    });
});

describe('Ethiopic typography', () => {
    const css = readFileSync(join(SRC, 'styles/index.css'), 'utf8');
    const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');

    it('components never uppercase, letter-space or italicise text', () => {
        expect(matches(/(?<=["'`\s])(?:uppercase|italic|tracking-[\w[\]().-]+)(?=["'`\s])/g)).toEqual([]);
    });

    it('an Ethiopic-script language drops casing, spacing and slanting whatever a screen applies', () => {
        const rule = /:lang\(am\),\s*:lang\(ti\),\s*:lang\(gez\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(rule).toContain('text-transform: none !important');
        expect(rule).toContain('letter-spacing: normal !important');
        expect(rule).toContain('font-style: normal !important');
        expect(css).toContain('font-synthesis-style: none');
    });

    it('components use the type scale only, so the Ethiopic 14 px floor applies (no text-[0.8rem], text-[10px])', () => {
        expect(matches(/\btext-\[[\d.]+(?:px|rem|em)\]/g)).toEqual([]);
    });

    it('Ethiopic text is never below 14 px and has taller lines: 1.6 for body sizes, 1.3 for headings', () => {
        const block = /:root:lang\(am\)[^{]*\{([^}]*)\}/.exec(tokens)?.[1] ?? '';
        expect(block).toContain('--text-xs: 0.875rem;');
        for (const s of ['xs', 'sm', 'base', 'lg']) expect(block).toContain(`--text-${s}--line-height: 1.6;`);
        for (const s of ['xl', '2xl', '3xl', '4xl', '5xl']) expect(block).toContain(`--text-${s}--line-height: 1.3;`);
    });

    it('labels and titles can wrap to a second line: no leading-none, truncate or nowrap', () => {
        const slots = ['label', 'card-title', 'dialog-title', 'sheet-title', 'alert-dialog-title', 'field-label'];
        const offenders = files.flatMap(({ path, text }) =>
            slots.flatMap((slot) => {
                const at = text.indexOf(`data-slot="${slot}"`);
                if (at < 0) return [];
                const classes = /className=\{cn\(\s*'([^']*)'/.exec(text.slice(at, at + 600))?.[1] ?? '';
                return /\b(?:leading-none|truncate|whitespace-nowrap|line-clamp-1)\b/.test(classes)
                    ? [`${path} ${slot}: ${classes}`]
                    : [];
            })
        );
        expect(offenders).toEqual([]);
    });
});

describe('fonts come from the app itself', () => {
    const css = readFileSync(join(SRC, 'styles/index.css'), 'utf8');
    const imports = [...css.matchAll(/@import '([^']+)'/g)].map((m) => m[1] ?? '');

    it('imports the three Noto families from the self-hosted packages and nothing remote', () => {
        expect(imports.filter((i) => i.startsWith('@fontsource-variable/'))).toEqual([
            '@fontsource-variable/noto-sans/wght.css',
            '@fontsource-variable/noto-sans-ethiopic/wght.css',
            '@fontsource-variable/noto-sans-mono/wght.css'
        ]);
        expect(css).not.toMatch(/https?:\/\//);
    });

    it.each(['noto-sans', 'noto-sans-ethiopic', 'noto-sans-mono'])(
        '@fontsource-variable/%s points only at files inside the package, split by unicode-range',
        (pkg) => {
            const file = require.resolve(`@fontsource-variable/${pkg}/wght.css`);
            const text = readFileSync(file, 'utf8');
            const urls = [...text.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? '');
            expect(urls.length).toBeGreaterThan(0);
            expect(urls.every((u) => u.startsWith('./files/') && u.endsWith('.woff2'))).toBe(true);
            expect(text).toContain('unicode-range');
            expect(text).toContain('font-display: swap');
            expect(dirname(file)).toContain(pkg);
        }
    );
});
