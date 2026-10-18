// Shared Vitest preset. Time is fixed to Africa/Addis_Ababa so date tests are deterministic (testing-strategy.md §2).
// unplugin-swc (decorator metadata for NestJS) is added here in task 0.6.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        env: { TZ: 'Africa/Addis_Ababa' },
        include: ['**/*.spec.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.spec.ts', '**/*.e2e.ts'],
        passWithNoTests: true
    }
});
