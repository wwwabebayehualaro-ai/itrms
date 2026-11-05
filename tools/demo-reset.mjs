// `pnpm demo:reset`: the demo from nothing, in under 2 minutes (task 0.25a, docs/demo-plan.md §6). It empties the development stack's
// database, migrates it and seeds everything the demo shows, then reports the time and fails if it took too long. It touches only the
// local stack, and needs the API built (`pnpm --filter @itrms/api build`) and the stack up (`pnpm dev:infra`). Stop a running API and
// worker first: their pools would hold connections to what was dropped.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps', 'api');
const LIMIT_SECONDS = 120;
const REGION = 'SER';

const inApi = (env, script, args = []) => {
    execFileSync('node', [`--env-file=${env}`, '--enable-source-maps', join('dist', script), ...args], {
        cwd: API,
        stdio: ['ignore', 'ignore', 'inherit']
    });
};
const seed = (...args) => inApi('.env.migrate.local', 'seed.cjs', args);

const STEPS = [
    [
        'empty the database',
        () =>
            execFileSync('node', [join('tools', 'dev-infra.mjs'), 'empty-database', '--yes'], {
                cwd: ROOT,
                stdio: ['ignore', 'ignore', 'inherit']
            })
    ],
    ['migrate', () => inApi('.env.migrate.local', 'migrate.cjs')],
    ['the org tree', () => seed('org', 'seed/org/south-ethiopia.wolaita.yaml')],
    [
        'the service catalogue',
        () => seed('services', '../../platform/services/seed/catalogue.yaml', '--region', REGION)
    ],
    ['the demo users', () => seed('users', 'seed/users/wolaita.demo.yaml')],
    ['the fee rules', () => seed('fees', '../../modules/competency/seed/fee-rules.demo.yaml', '--region', REGION)],
    ['the receipt counters', () => seed('counters', '--region', REGION)],
    ['the document templates', () => seed('documents', '--region', REGION)],
    ['the licence services', () => seed('competency', '--region', REGION)],
    ['the demo’s people and licences', () => seed('demo', '--region', REGION)],
    ['the accounts in Keycloak', () => seed('identity')]
];

if (!existsSync(join(API, 'dist', 'seed.cjs'))) {
    console.error('demo:reset needs the API built: pnpm --filter @itrms/api build');
    process.exit(1);
}
const started = Date.now();
for (const [name, run] of STEPS) {
    const from = Date.now();
    run();
    console.log(`  ${name}: ${((Date.now() - from) / 1000).toFixed(1)} s`);
}
const seconds = (Date.now() - started) / 1000;
console.log(`The demo is ready in ${seconds.toFixed(1)} s (limit ${LIMIT_SECONDS} s).`);
if (seconds > LIMIT_SECONDS) {
    console.error(`demo:reset took longer than its ${LIMIT_SECONDS} s.`);
    process.exit(1);
}
