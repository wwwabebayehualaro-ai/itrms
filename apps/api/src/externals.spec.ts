/**
 * The bundle keeps npm packages external, and Node resolves them from apps/api/node_modules. pnpm installs a workspace
 * package's dependencies only for that package, so the API must declare every npm dependency of the workspace packages it
 * bundles, or the built process fails at start ("Cannot find module").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Manifest {
    name: string;
    dependencies?: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Manifest;
const api = read(join(here, '..', 'package.json'));

/** The npm dependencies of every workspace package reachable from `manifest`, with who needs each. */
function npmDependencies(manifest: Manifest, from: string, seen = new Set<string>()): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        if (!range.startsWith('workspace:')) {
            out.set(name, manifest.name);
            continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        // the workspace link pnpm makes in the package's own node_modules (its exports do not list package.json)
        const path = join(dirname(from), 'node_modules', name, 'package.json');
        for (const [dep, owner] of npmDependencies(read(path), path, seen)) if (!out.has(dep)) out.set(dep, owner);
    }
    return out;
}

describe('the API bundle', () => {
    it('declares every npm dependency of the workspace packages it bundles', () => {
        const declared = new Set(Object.keys(api.dependencies ?? {}));
        const missing = [...npmDependencies(api, join(here, '..', 'package.json'))]
            .filter(([dep]) => !declared.has(dep))
            .map(([dep, owner]) => `${dep} (needed by ${owner})`);
        expect(missing).toEqual([]);
    });
});
