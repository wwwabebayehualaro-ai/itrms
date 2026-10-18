#!/usr/bin/env node
// Renders modules/_template into a new slice package (code-structure.md §4, §10).
// Used by `turbo gen module` and to create the platform slices, so every slice starts from the same files.
//
//   node tools/scaffold/slice.mjs <key> --layer <kernel|platform|registry|work-process> --summary "..." [--deps a,b]
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE = join(ROOT, 'modules', '_template');
export const LAYERS = ['kernel', 'platform', 'registry', 'work-process'];

/** The public entries every slice package exports, and the scripts it runs (checked by tools/check-slices.mjs). */
export const SLICE_EXPORTS = {
    './manifest': './module.ts',
    './contracts': './contracts/index.ts',
    './api': './api/index.ts',
    './api/worker': './api/worker.ts',
    './web/server': './web/server.ts',
    './web/client': './web/client.ts',
    './messages/*': './messages/*.json',
    './seed': './seed/index.ts'
};
export const SLICE_SCRIPTS = {
    lint: 'eslint .',
    typecheck: 'tsc --noEmit -p tsconfig.json',
    test: 'vitest run --passWithNoTests'
};
export const LANGUAGES = ['am', 'en', 'wal-Latn'];

export function sliceDir(key, layer) {
    return join(ROOT, layer === 'kernel' || layer === 'platform' ? 'platform' : 'modules', key);
}

function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const KEY = /^[a-z][a-z0-9-]*$/;

/** Package folder names already used anywhere in the workspace (package names are flat: @itrms/<folder>). */
export function workspaceNames(root = ROOT) {
    return ['apps', 'platform', 'modules', 'packages'].flatMap((group) =>
        existsSync(join(root, group)) ? readdirSync(join(root, group)) : []
    );
}

/** Copies the template and fills its placeholders. Refuses to overwrite or duplicate an existing package. */
export function renderSlice({ key, layer, summary, deps = [] }) {
    if (!KEY.test(key)) throw new Error(`Slice key "${key}" must be kebab-case`);
    if (!LAYERS.includes(layer)) throw new Error(`Layer must be one of ${LAYERS.join(', ')}`);
    if (!summary?.trim())
        throw new Error('A one-line --summary is required (it goes into package.json and the README)');
    if (/[\r\n]/.test(summary)) throw new Error('The summary must be one line');
    const badDep = deps.find((d) => !KEY.test(d) || d === key);
    if (badDep) throw new Error(`dependsOn "${badDep}" must be another slice's kebab-case key`);
    const target = sliceDir(key, layer);
    if (existsSync(target)) throw new Error(`${relative(ROOT, target)} already exists`);
    if (workspaceNames().includes(key)) throw new Error(`@itrms/${key} already exists elsewhere in the workspace`);

    cpSync(TEMPLATE, target, { recursive: true });
    const values = {
        __key__: key,
        __layer__: layer,
        __deps__: deps.map((d) => `'${d}'`).join(', ')
    };
    for (const file of walk(target)) {
        const text = readFileSync(file, 'utf8');
        // Inside JSON the summary is escaped; everywhere else (README) it is written as typed.
        const summaryText = file.endsWith('.json') ? JSON.stringify(summary).slice(1, -1) : summary;
        const out = text.replace(/__key__|__layer__|__summary__|__deps__/g, (m) =>
            m === '__summary__' ? summaryText : values[m]
        );
        if (out !== text) writeFileSync(file, out, 'utf8');
    }
    return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [key, ...rest] = process.argv.slice(2);
    const opt = (name) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : undefined;
    };
    try {
        const deps = (opt('deps') ?? '').split(',').filter(Boolean);
        const dir = renderSlice({ key, layer: opt('layer'), summary: opt('summary'), deps });
        console.log(`Created ${relative(ROOT, dir)}. Next: pnpm install, then register it in the composition roots.`);
    } catch (e) {
        console.error(`scaffold: ${e.message}`);
        process.exit(1);
    }
}
