import config from '@itrms/config/eslint';

export default [
    ...config({ dir: import.meta.dirname, react: true }),
    {
        // command-line checks: their output is the report
        files: ['scripts/**/*.mts'],
        rules: { 'no-console': 'off' }
    }
];
