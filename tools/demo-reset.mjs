// `pnpm demo:reset`: the demo from nothing, in under 2 minutes (task 0.25a, docs/demo-plan.md §6). It empties the development stack's
// database, migrates it and seeds everything the demo shows, then reports the time and fails if it took too long. It touches only the
// local stack, and needs the API built (`pnpm --filter @itrms/api build`) and the stack up (`pnpm dev:infra`). Stop a running API and
// worker first: their pools would hold connections to what was dropped.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps', 'api');
const LIMIT_SECONDS = 120;
const REGION = 'SER';
const CITY = 'SCA';

const inApi = (env, script, args = []) => {
    execFileSync('node', [`--env-file=${env}`, '--enable-source-maps', join('dist', script), ...args], {
        cwd: API,
        // their logs say why a step failed
        stdio: 'inherit'
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
    ['the demo’s people and licences', () => inApi('.env.demo.local', 'seed.cjs', ['demo', '--region', REGION])],
    // the second region: a city administration with sub-cities (task 0.25b), with the same services and rules
    ['the second region', () => seed('org', 'seed/org/sample-city.yaml')],
    ['its catalogue', () => seed('services', '../../platform/services/seed/catalogue.yaml', '--region', CITY)],
    ['its users', () => seed('users', 'seed/users/sample-city.demo.yaml')],
    ['its fee rules', () => seed('fees', '../../modules/competency/seed/fee-rules.demo.yaml', '--region', CITY)],
    ['its receipt counters', () => seed('counters', '--region', CITY)],
    ['its document templates', () => seed('documents', '--region', CITY)],
    ['its licence services', () => seed('competency', '--region', CITY)],
    ['its branding and languages', () => seed('demo-city', '--region', CITY)],
    ['the accounts in Keycloak', () => seed('identity')]
];

// all before anything is dropped
if (!existsSync(join(API, 'dist', 'seed.cjs'))) {
    console.error('demo:reset needs the API built: pnpm --filter @itrms/api build');
    process.exit(1);
}
for (const env of ['.env.migrate.local', '.env.demo.local']) {
    const file = join(API, env);
    if (!existsSync(file) || !readFileSync(file, 'utf8').includes('NODE_ENV=development')) {
        console.error(
            `demo:reset is for the local development stack: ${env} is not one of its settings. Run pnpm dev:infra.`
        );
        process.exit(1);
    }
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
