// Makes the static export an installable app that opens offline (ADR-0046): its manifest, named from the catalogues, and its service
// worker, with the precache list of what this build emitted. Run after `next build` and before csp.mjs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injectManifest } from '@serwist/build';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');

const am = JSON.parse(readFileSync(join(HERE, '..', 'messages', 'am.json'), 'utf8'));

writeFileSync(
    join(OUT, 'manifest.webmanifest'),
    JSON.stringify({
        name: am['verify.app.name'],
        short_name: am['verify.app.shortName'],
        lang: 'am',
        start_url: '/scan',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0a6b35',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
    })
);

const work = mkdtempSync(join(tmpdir(), 'itrms-verify-sw-'));
try {
    const bundled = join(work, 'sw.js');
    await build({
        entryPoints: [join(HERE, 'sw.source.js')],
        bundle: true,
        format: 'iife',
        minify: true,
        target: 'es2020',
        outfile: bundled,
        logLevel: 'warning'
    });
    const { count, size, warnings } = await injectManifest({
        swSrc: bundled,
        swDest: join(OUT, 'sw.js'),
        globDirectory: OUT,
        globPatterns: ['**/*.{html,js,css,woff2,png,webmanifest}'],
        globIgnores: ['sw.js', '404.html', '_not-found.html', '_not-found/**'],
        dontCacheBustURLsMatching: /^_next\/static\//
    });
    if (warnings.length) throw new Error(warnings.join('\n'));
    process.stdout.write(`sw.js: ${count} files, ${Math.round(size / 1024)} KiB precached\n`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
