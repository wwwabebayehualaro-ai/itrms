// Unit tests for the platform (and, later, coded features): `npm test`. Browser flows are Playwright (`npm run e2e`).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    resolve: {
        // same aliases as tsconfig.json (most specific first)
        alias: [
            { find: /^@platform\//, replacement: here('./platform/') },
            { find: /^@\//, replacement: here('./') }
        ]
    },
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'happy-dom',
        include: ['tests/unit/**/*.test.{ts,tsx}'],
        setupFiles: ['tests/unit/setup.ts'],
        restoreMocks: true
    }
});
