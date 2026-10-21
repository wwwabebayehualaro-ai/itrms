// Vitest preset for NestJS code (the API, the kernel and slices' api/): the shared preset plus unplugin-swc, so decorators
// and their type metadata are compiled as in the API bundle and dependency injection by type works in tests.
import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.js';

export default mergeConfig(
    base,
    defineConfig({
        plugins: [
            swc.vite({
                jsc: {
                    parser: { syntax: 'typescript', decorators: true },
                    transform: { legacyDecorator: true, decoratorMetadata: true },
                    target: 'es2023'
                },
                module: { type: 'es6' }
            })
        ],
        // swc compiles TypeScript here; Vite's own transform would drop the decorator metadata
        oxc: false
    })
);
