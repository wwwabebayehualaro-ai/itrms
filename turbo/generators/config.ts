// `pnpm gen <generator>` (turbo gen): scaffolds slices and their parts with the shapes of code-structure.md §4–§6.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { PlopTypes } from '@turbo/gen';

const LAYERS = ['registry', 'work-process', 'platform'];

/** The repository root: the nearest directory with pnpm-workspace.yaml (generators load before turbo passes paths). */
function repoRoot(from = process.cwd()): string {
    let dir = from;
    while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('pnpm-workspace.yaml not found above ' + from);
        dir = up;
    }
    return dir;
}

function slices(root: string): string[] {
    return ['platform', 'modules'].flatMap((layer) =>
        readdirSync(join(root, layer))
            .filter((name) => !name.startsWith('_') && statSync(join(root, layer, name)).isDirectory())
            .map((name) => `${layer}/${name}`)
    );
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
    const root = repoRoot();
    const kebab = (v: string) => /^[a-z][a-z0-9-]*$/.test(v) || 'Use kebab-case (e.g. road-safety)';
    const slicePrompt = { type: 'list', name: 'slicePath', message: 'Which slice?', choices: slices(root) };
    plop.setHelper('sliceKey', (slicePath: string) => slicePath.split('/')[1]);

    plop.setGenerator('module', {
        description: 'A new slice package from modules/_template (registry, work process or platform service)',
        prompts: [
            { type: 'input', name: 'key', message: 'Slice key (kebab-case):', validate: kebab },
            { type: 'list', name: 'layer', message: 'Layer:', choices: LAYERS },
            { type: 'input', name: 'summary', message: 'One-line summary:' },
            {
                type: 'input',
                name: 'deps',
                message: 'dependsOn (comma-separated, e.g. kernel,drivers):',
                default: 'kernel'
            }
        ],
        actions: [
            (answers) => {
                const a = answers as { key: string; layer: string; summary: string; deps: string };
                // The scaffold runs as its own process: turbo gen compiles this file to CommonJS, the script is an ES module.
                return execFileSync(
                    process.execPath,
                    [
                        join(root, 'tools', 'scaffold', 'slice.mjs'),
                        a.key,
                        '--layer',
                        a.layer,
                        '--summary',
                        a.summary,
                        '--deps',
                        a.deps
                    ],
                    { cwd: root, encoding: 'utf8' }
                ).trim();
            }
        ]
    });

    plop.setGenerator('feature', {
        description: 'A feature folder in a slice: controller, service, repository, table and a service spec',
        prompts: [
            slicePrompt,
            { type: 'input', name: 'name', message: 'Feature (plural noun, kebab-case):', validate: kebab }
        ],
        actions: ['controller', 'service', 'repository', 'table']
            .map((kind) => ({
                type: 'add',
                path: '{{slicePath}}/api/{{kebabCase name}}/{{kebabCase name}}.' + kind + '.ts',
                templateFile: `templates/feature/${kind}.ts.hbs`
            }))
            .concat([
                {
                    type: 'add',
                    path: '{{slicePath}}/api/{{kebabCase name}}/{{kebabCase name}}.service.spec.ts',
                    templateFile: 'templates/feature/service.spec.ts.hbs'
                }
            ])
    });

    plop.setGenerator('screen', {
        description: 'A screen (Server Component) in a slice',
        prompts: [
            slicePrompt,
            { type: 'input', name: 'name', message: 'Screen (kebab-case, e.g. applications-list):', validate: kebab }
        ],
        actions: [
            {
                type: 'add',
                path: '{{slicePath}}/web/screens/{{kebabCase name}}.screen.tsx',
                templateFile: 'templates/screen/screen.tsx.hbs'
            }
        ]
    });

    plop.setGenerator('effect', {
        description: 'A workflow effect in a slice',
        prompts: [
            slicePrompt,
            { type: 'input', name: 'name', message: 'Effect (kebab-case, e.g. issue-licence):', validate: kebab }
        ],
        actions: [
            {
                type: 'add',
                path: '{{slicePath}}/api/effects/{{kebabCase name}}.effect.ts',
                templateFile: 'templates/effect/effect.ts.hbs'
            }
        ]
    });
}
