import assert from 'node:assert/strict';
import { test } from 'node:test';

import { batchedSteps, demoSteps } from './demo-reset.mjs';

const plan = () => demoSteps((settings, script, args) => ({ settings, script, args }));

test('demo:reset runs seed steps in a row with the same settings in one process, in the same order', () => {
    const calls = [];
    const steps = batchedSteps(plan(), (settings, script, args) => calls.push({ settings, script, args }));
    for (const [, run] of steps) run();

    // migrate · both regions · the generated people, licences and vehicles (other settings) · the accounts
    assert.deepEqual(
        calls.map((c) => [c.settings, c.script]),
        [
            ['migrate', 'migrate.cjs'],
            ['migrate', 'seed.cjs'],
            ['demo', 'seed.cjs'],
            ['migrate', 'seed.cjs']
        ]
    );
    // nothing lost or reordered: the batched commands are the steps' own
    const seeds = plan()
        .map(([, step]) => step())
        .filter((s) => s.script === 'seed.cjs')
        .map((s) => s.args.join(' '));
    const batched = calls.filter((c) => c.script === 'seed.cjs').flatMap((c) => c.args.join(' ').split(' --then '));
    assert.deepEqual(batched, seeds);
    assert.equal(steps.length, calls.length);
});
