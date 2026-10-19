// Design tokens as data (@itrms/ui/tokens): for charts, PDF templates and documentation. No React, no DOM.
export {
    CONTRAST_PAIRS,
    DENSITIES,
    densities,
    ETHIOPIC_LANGUAGES,
    fonts,
    palette,
    resolveColor,
    resolveToken,
    THEMES,
    themes,
    TONES,
    typography
} from './tokens';
export type {
    ColorRef,
    ComponentTokens,
    Density,
    SemanticToken,
    SemanticTokens,
    StatusTone,
    ThemeName
} from './tokens';
export { contrast, formatOklch, parseOklch } from './color';
