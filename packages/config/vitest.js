// Shared Vitest preset. Time is fixed to Africa/Addis_Ababa so date tests are deterministic (testing-strategy.md §2).
// unplugin-swc (decorator metadata for NestJS) is added here in task 0.6.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        env: { TZ: 'Africa/Addis_Ababa' },
        include: ['**/*.spec.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.spec.ts', '**/*.perf.spec.ts', '**/*.e2e.ts'],
        passWithNoTests: true,
        // Component tests drive real dialogs and forms with user-event; on a 4-core CI machine running every package at
        // once they take 5–8 s, so Vitest's 5 s default fails them (seen on local Linux CI).
        testTimeout: 20_000
    }
});
