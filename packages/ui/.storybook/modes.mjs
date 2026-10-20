// The modes every story is tested in: Amharic in each theme and density, and English in the default look (task 0.4a).
// Plain JavaScript so both the Vitest config and the runner (run-stories.mjs) can import it; modes.spec.ts checks that it
// covers every theme and density in src/tokens/tokens.ts.
export const THEME_NAMES = ['light', 'dark', 'high-contrast'];
export const DENSITY_NAMES = ['comfortable', 'compact'];

export const MODES = [
    ...THEME_NAMES.flatMap((theme) => DENSITY_NAMES.map((density) => `am/${theme}/${density}`)),
    'en/light/comfortable'
];

export const projectName = (mode) => `stories ${mode}`;
