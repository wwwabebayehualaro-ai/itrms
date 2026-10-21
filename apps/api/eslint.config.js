import config from '@itrms/config/eslint';

export default [
    ...config({ dir: import.meta.dirname, node: true }),
    {
        // Nest's CLI require()s its webpack config: that file stays CommonJS
        files: ['webpack.config.cjs'],
        languageOptions: { sourceType: 'commonjs' },
        rules: { '@typescript-eslint/no-require-imports': 'off' }
    }
];
