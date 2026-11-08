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
/**
 * The demo's seed steps (task 0.26a: also the production profile's, tools/prod-stack.mjs), with the caller's runner:
 * `run(settings, script, args)` where settings is 'migrate' (the owner's connection, Keycloak) or 'demo' (also the personal
 * data keys, for the generated people).
 */
export function demoSteps(run) {
    const seed = (...args) => run('migrate', 'seed.cjs', args);

    /** What every region is built from, in order. */
    const regionSteps = (code, org, users) => [
        [`${code}: the org tree`, () => seed('org', `seed/org/${org}.yaml`)],
        [
            `${code}: the service catalogue`,
            () => seed('services', '../../platform/services/seed/catalogue.yaml', '--region', code)
        ],
        [`${code}: the users`, () => seed('users', `seed/users/${users}.yaml`)],
        [
            `${code}: the fee rules`,
            () => seed('fees', '../../modules/competency/seed/fee-rules.demo.yaml', '--region', code)
        ],
        [`${code}: the receipt counters`, () => seed('counters', '--region', code)],
        [`${code}: the document templates`, () => seed('documents', '--region', code)],
        [`${code}: the licence services`, () => seed('competency', '--region', code)],
        [`${code}: the vehicle categories`, () => seed('vehicles', '--region', code)]
    ];

    return [
        ['migrate', () => run('migrate', 'migrate.cjs', [])],
        ...regionSteps(REGION, 'south-ethiopia.wolaita', 'wolaita.demo'),
        ['the demo’s people and licences', () => run('demo', 'seed.cjs', ['demo', '--region', REGION])],
        [`${REGION}: its branding`, () => seed('settings', 'seed/settings/sample-region.demo.yaml')],
        // the second region: a city administration with sub-cities (task 0.25b), with the same services and rules
        ...regionSteps(CITY, 'sample-city', 'sample-city.demo'),
        [`${CITY}: its branding and languages`, () => seed('settings', 'seed/settings/sample-city.demo.yaml')],
        ['the accounts in Keycloak', () => seed('identity')]
    ];
}

const devRun = (settings, script, args) =>
    inApi(settings === 'demo' ? '.env.demo.local' : '.env.migrate.local', script, args);

/**
 * The demo's steps as they run here: seed steps in a row with the same settings go in one process (`seed … --then …`).
 * On Windows a Node start alone takes about five seconds, and the demo has twenty seed steps (the 2-minute limit).
 */
export function batchedSteps(steps, run = devRun) {
    const planned = steps.map(([name, step]) => ({ name, ...step() }));
    const runs = [];
    for (const p of planned) {
        const last = runs.at(-1);
        if (p.script === 'seed.cjs' && last?.script === 'seed.cjs' && last.settings === p.settings) {
            last.names.push(p.name);
            last.args.push('--then', ...p.args);
        } else runs.push({ names: [p.name], settings: p.settings, script: p.script, args: [...p.args] });
    }
    return runs.map(({ names, settings, script, args }) => [names.join(' · '), () => run(settings, script, args)]);
}

const STEPS = [
    [
        'empty the database',
        () =>
            execFileSync('node', [join('tools', 'dev-infra.mjs'), 'empty-database', '--yes'], {
                cwd: ROOT,
                stdio: ['ignore', 'ignore', 'inherit']
            })
    ],
    ...batchedSteps(demoSteps((settings, script, args) => ({ settings, script, args })))
];

const main = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (main) {
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
}
