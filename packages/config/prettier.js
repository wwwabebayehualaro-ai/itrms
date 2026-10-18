/** Shared Prettier config. Matches the existing code style: 4 spaces, single quotes, 120 columns. */
export default {
    printWidth: 120,
    tabWidth: 4,
    singleQuote: true,
    trailingComma: 'none',
    overrides: [{ files: ['*.json', '*.yml', '*.yaml'], options: { tabWidth: 2 } }]
};
