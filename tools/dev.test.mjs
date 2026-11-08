import assert from 'node:assert/strict';
import { test } from 'node:test';

import { devProcesses, missing } from './dev.mjs';

test('pnpm dev runs the API, both workers and the web app, each with its own settings', () => {
    const all = devProcesses({ nextBin: 'next' });
    assert.deepEqual(
        all.map((p) => p.name),
        ['api', 'worker', 'docs', 'web']
    );
    assert.ok(all[0].args.includes('--env-file=.env.http.local'));
    assert.ok(all[1].args.includes('--env-file=.env.worker.local'));
    assert.deepEqual(all[3].args, ['next', 'dev', '-p', '3000']);
    assert.deepEqual(
        devProcesses({ workers: false }).map((p) => p.name),
        ['api', 'web']
    );
});

test('pnpm dev says what is missing before it starts anything', () => {
    assert.deepEqual(
        missing(() => true),
        []
    );
    const problems = missing(() => false);
    assert.equal(problems.length, 4);
    assert.ok(problems[0].includes('pnpm --filter @itrms/api build'));
    assert.ok(problems.slice(1).every((p) => p.includes('pnpm dev:infra')));
});
