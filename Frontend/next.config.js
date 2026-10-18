/** @type {import('next').NextConfig} */
const nextConfig = {
    // a second dev server (e.g. the e2e tests) must not share .next with the one a developer is running: NEXT_DIST_DIR=.next-e2e
    distDir: process.env.NEXT_DIST_DIR || '.next',
    async redirects() {
        // the builder used to live at a path derived from its folder structure
        return [{ source: '/dynamic-template/components/Template-Builder', destination: '/dynamic-template/builder', permanent: true }];
    },
    // Turbopack (the default bundler for dev and build): pdfjs-dist 3.x optionally requires the Node-only `canvas` package;
    // the browser build must not try to resolve it.
    turbopack: {
        resolveAlias: { canvas: './platform/lib/emptyModule.js' }
    },
    // the same for webpack (`next dev --webpack`): a fallback where Turbopack cannot start its worker processes
    webpack: (config) => {
        config.resolve.alias = { ...config.resolve.alias, canvas: false };
        return config;
    }
};

module.exports = nextConfig;
