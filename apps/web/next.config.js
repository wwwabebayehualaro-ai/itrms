import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import createNextIntlPlugin from 'next-intl/plugin';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
    // A second dev server (e.g. the e2e tests) must not share .next with the one a developer is running: NEXT_DIST_DIR=.next-e2e
    distDir: process.env.NEXT_DIST_DIR || '.next',
    // Workspace packages are TypeScript source (code-structure.md §5.5): Next compiles them.
    transpilePackages: ['@itrms/ui', '@itrms/form-engine', '@itrms/schemas'],
    outputFileTracingRoot: monorepoRoot,
    async redirects() {
        // the builder used to live at a path derived from its folder structure
        return [
            {
                source: '/dynamic-template/components/Template-Builder',
                destination: '/dynamic-template/builder',
                permanent: true
            }
        ];
    },
    // pdf.js optionally requires the Node-only `canvas` package; the browser build must not try to resolve it.
    turbopack: {
        root: monorepoRoot,
        resolveAlias: { canvas: './src/lib/emptyModule.js' }
    },
    webpack: (config) => {
        config.resolve.alias = { ...config.resolve.alias, canvas: false };
        return config;
    }
};

// next-intl: the messages and the language of each request (src/i18n/request.ts)
export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
