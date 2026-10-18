// Shared ESLint flat config for every workspace package (code-structure.md §10).
// Type-aware rules use the TypeScript project service, so each package's tsconfig.json drives them.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * @param {{ dir: string, node?: boolean }} options  dir: the package directory (`import.meta.dirname`), so type-aware
 *   linting finds the right tsconfig.json when ESLint runs from the repository root (lefthook) or from the package (turbo).
 */
export default function config(options) {
    return tseslint.config(
        { ignores: ['dist/**', 'coverage/**', '.turbo/**', 'node_modules/**'] },
        js.configs.recommended,
        ...tseslint.configs.recommendedTypeChecked,
        {
            languageOptions: {
                parserOptions: { projectService: true, tsconfigRootDir: options.dir },
                globals: options.node ? globals.node : { ...globals.browser, ...globals.node }
            },
            rules: {
                '@typescript-eslint/no-explicit-any': 'error',
                '@typescript-eslint/no-non-null-assertion': 'error',
                '@typescript-eslint/consistent-type-imports': 'error',
                'no-console': ['error', { allow: ['warn', 'error'] }]
            }
        },
        {
            // Code that runs in the API (or in both places) must not touch the DOM: form-engine core, slice contracts
            // and slice api/. The packages' tsconfig includes the DOM lib for their web parts, so lint enforces it.
            files: ['src/core/**/*.{ts,tsx}', 'contracts/**/*.{ts,tsx}', 'api/**/*.{ts,tsx}'],
            rules: {
                'no-restricted-globals': [
                    'error',
                    ...BROWSER_GLOBALS.map((name) => ({ name, message: 'This code also runs on the server: no DOM.' }))
                ],
                'no-restricted-syntax': [
                    'error',
                    { selector: 'JSXElement, JSXFragment', message: 'No JSX here: this code also runs on the server.' }
                ]
            }
        },
        {
            files: ['**/*.{js,mjs,cjs}'],
            ...tseslint.configs.disableTypeChecked
        }
    );
}

const BROWSER_GLOBALS = [
    'window',
    'document',
    'navigator',
    'location',
    'localStorage',
    'sessionStorage',
    'HTMLElement'
];
