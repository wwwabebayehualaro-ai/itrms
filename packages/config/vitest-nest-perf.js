// Vitest preset for performance checks of NestJS code (test/perf/*.perf.spec.ts): the integration preset with large
// data sets, so much longer timeouts. Run on demand and before a release, not with every change.
import { defineConfig } from 'vitest/config';

import integration from './vitest-nest-int.js';

export default defineConfig({
    ...integration,
    test: {
        ...integration.test,
        include: ['test/perf/**/*.perf.spec.ts'],
        testTimeout: 600_000,
        hookTimeout: 1_200_000
    }
});
