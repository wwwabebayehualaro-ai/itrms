#!/usr/bin/env node
// Every slice package (platform/*, modules/*) has the same shape (code-structure.md §4, ADR-0032): name, public
// exports, scripts, manifest, README and a catalogue per language. Run: pnpm check:slices (CI).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, ROOT, SLICE_EXPORTS, SLICE_SCRIPTS } from './scaffold/slice.mjs';

const { PLATFORM_ORDER } = createRequire(import.meta.url)('./boundaries/layers.cjs');

/** Problems of one slice directory; empty when it follows the shape. */
export function sliceProblems(dir) {
    const problems = [];
    const key = dir.split(/[\\/]/).at(-1);
    const pkgFile = join(dir, 'package.json');
    if (!existsSync(pkgFile)) return ['package.json is missing'];
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));

    if (pkg.name !== `@itrms/${key}`) problems.push(`name must be @itrms/${key} (is ${pkg.name})`);
    if (pkg.private !== true) problems.push('must be private');
    if (pkg.type !== 'module') problems.push('type must be "module"');
    for (const [entry, target] of Object.entries(SLICE_EXPORTS)) {
        if (pkg.exports?.[entry] !== target) problems.push(`exports["${entry}"] must be "${target}"`);
    }
    for (const [name, cmd] of Object.entries(SLICE_SCRIPTS)) {
        if (pkg.scripts?.[name] !== cmd) problems.push(`scripts.${name} must be "${cmd}"`);
    }
    for (const [entry, target] of Object.entries(pkg.exports ?? {})) {
        if (entry.includes('*')) continue;
        if (!existsSync(join(dir, target))) problems.push(`exports["${entry}"] points at a missing file ${target}`);
    }
    for (const lang of LANGUAGES) {
        if (!existsSync(join(dir, 'messages', `${lang}.json`))) problems.push(`messages/${lang}.json is missing`);
    }
    if (!existsSync(join(dir, 'README.md'))) problems.push('README.md is missing');
    const manifest = existsSync(join(dir, 'module.ts')) ? readFileSync(join(dir, 'module.ts'), 'utf8') : '';
    if (!manifest.includes(`key: '${key}'`)) problems.push(`module.ts must declare key: '${key}'`);
    if (/__(key|layer|summary|deps)__/.test(JSON.stringify(pkg) + manifest))
        problems.push('template placeholders left');
    return problems;
}

export function sliceDirs(root = ROOT) {
    return ['platform', 'modules'].flatMap((layer) => {
        const base = join(root, layer);
        if (!existsSync(base)) return [];
        return readdirSync(base)
            .filter((name) => !name.startsWith('_') && statSync(join(base, name)).isDirectory())
            .map((name) => join(base, name));
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    let failed = 0;
    const dirs = sliceDirs();
    for (const dir of dirs) {
        const problems = sliceProblems(dir);
        if (problems.length) {
            failed++;
            console.error(`✖ ${relative(ROOT, dir)}\n${problems.map((p) => `    ${p}`).join('\n')}`);
        }
    }
    if (failed) {
        console.error(`\n${failed} of ${dirs.length} slices do not follow docs/platform/code-structure.md §4.`);
        process.exit(1);
    }
    console.log(`✔ ${dirs.length} slices follow the slice shape`);
}
