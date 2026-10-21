import config from '@itrms/config/eslint';

export default [
    ...config({ dir: import.meta.dirname, react: true }),
    {
        // The renderer, designer and viewer came from the web app (task 0.5), which had no typed linting. Their `any` (stored
        // templates are loose JSON) is typed as these parts are reworked in tasks 0.17–0.18; core/ and host/ are strict now.
        files: [
            'src/api/**/*.{ts,tsx}',
            'src/renderer/**/*.{ts,tsx}',
            'src/designer/**/*.{ts,tsx}',
            'src/viewer/**/*.{ts,tsx}',
            'scripts/**/*.mts'
        ],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/no-redundant-type-constituents': 'off'
        }
    },
    {
        // command-line checks: their output is the report
        files: ['scripts/**/*.mts'],
        rules: { 'no-console': 'off' }
    }
];
