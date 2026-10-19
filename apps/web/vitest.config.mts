// Unit tests of the web app (pnpm test). Browser flows are Playwright (pnpm e2e).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // the same alias as tsconfig.json
        alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }]
    },
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'happy-dom',
        env: { TZ: 'Africa/Addis_Ababa' },
        include: ['tests/unit/**/*.test.{ts,tsx}'],
        setupFiles: ['tests/unit/setup.ts'],
        restoreMocks: true,
        // These are user-event journeys through whole screens (designer, approval inbox, data viewer). The 5 s default
        // fails them on a loaded CI machine, where every package builds and tests in parallel (7 s seen on local Linux CI).
        testTimeout: 20_000
    }
});
