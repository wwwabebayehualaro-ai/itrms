// Unit and component tests of the engine: happy-dom, Testing Library, jest-dom matchers. core's own tests run in Node
// (`// @vitest-environment node` at the top of the file), which proves core needs no DOM.
import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@itrms/config/vitest';

export default mergeConfig(
    base,
    defineConfig({
        esbuild: { jsx: 'automatic' },
        test: { environment: 'happy-dom', setupFiles: ['./src/test-setup.ts'], restoreMocks: true }
    })
);
