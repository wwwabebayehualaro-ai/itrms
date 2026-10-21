// Vitest preset for integration tests of NestJS code (test/integration/*.int.spec.ts): the swc compilation of the nest
// preset, against real services (a PostgreSQL container, the dev stack). Slow by nature: longer timeouts.
import { defineConfig } from 'vitest/config';

import nest from './vitest-nest.js';

export default defineConfig({
    plugins: nest.plugins,
    oxc: false,
    test: {
        include: ['test/integration/**/*.int.spec.ts'],
        env: { TZ: 'Africa/Addis_Ababa' },
        testTimeout: 60_000,
        hookTimeout: 240_000
    }
});
