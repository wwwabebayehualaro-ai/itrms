// Component tests of the design system: happy-dom, Testing Library, jest-dom matchers.
import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@itrms/config/vitest';

export default mergeConfig(
    base,
    defineConfig({
        esbuild: { jsx: 'automatic' },
        test: { environment: 'happy-dom', setupFiles: ['./src/test-setup.ts'], restoreMocks: true }
    })
);
