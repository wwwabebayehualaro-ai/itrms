// Integration tests (*.int.spec.ts) against the dev stack: pnpm dev:infra first.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/integration/**/*.int.spec.ts'],
        env: { TZ: 'Africa/Addis_Ababa' },
        testTimeout: 60_000
    }
});
