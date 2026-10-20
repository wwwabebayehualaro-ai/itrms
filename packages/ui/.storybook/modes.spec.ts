import { describe, expect, it } from 'vitest';

import { DENSITIES, THEMES } from '../src/tokens/tokens';
import { DENSITY_NAMES, MODES, THEME_NAMES } from './modes.mjs';

describe('story test modes', () => {
    it('cover every theme and density in Amharic, and the default look in English', () => {
        expect(THEME_NAMES).toEqual([...THEMES]);
        expect(DENSITY_NAMES).toEqual([...DENSITIES]);
        expect(MODES).toHaveLength(THEMES.length * DENSITIES.length + 1);
        expect(MODES).toContain('en/light/comfortable');
    });
});
