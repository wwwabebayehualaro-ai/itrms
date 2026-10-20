#!/usr/bin/env node
// Runs the story tests one mode at a time. Seven Chromium sessions and Vite servers starting together don't fit a
// 4-core CI machine (the browser sessions time out before they connect), so the modes run in turn and every mode is
// reported, even after a failure. Extra arguments go to Vitest (e.g. a story file).
//
// A mode normally takes under a minute. A browser that loses its connection to Vitest hangs the run for good (the test
// timeout runs inside that browser, so it never fires), so a mode that passes MODE_TIMEOUT_MS is killed and run once
// more; the retry is printed. A mode whose tests fail is never retried, but a failure printed before a hang is only in
// the first run's log.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { MODES, projectName } from './modes.mjs';

const root = join(import.meta.dirname, '..');
// Vitest is a workspace dev dependency (hoisted), so it is resolved, not assumed under this package's node_modules.
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const MODE_TIMEOUT_MS = 10 * 60_000;
const runMode = (mode) =>
    spawnSync(
        process.execPath,
        [
            vitest,
            'run',
            '--config',
            'vitest.stories.config.ts',
            '--project',
            projectName(mode),
            ...process.argv.slice(2)
        ],
        { cwd: root, stdio: 'inherit', timeout: MODE_TIMEOUT_MS, killSignal: 'SIGKILL' }
    );
const timedOut = (r) => r.error?.code === 'ETIMEDOUT';

const failed = [];
const retried = [];
for (const mode of MODES) {
    process.stdout.write(`\n=== stories ${mode} ===\n`);
    let r = runMode(mode);
    if (timedOut(r)) {
        process.stdout.write(
            `\n=== stories ${mode}: no result after ${MODE_TIMEOUT_MS / 60_000} min, running it again ===\n`
        );
        retried.push(mode);
        r = runMode(mode);
        if (timedOut(r)) process.stdout.write(`\n=== stories ${mode}: no result again ===\n`);
    }
    if (r.status !== 0) failed.push(mode);
}
if (retried.length) process.stdout.write(`\nModes run again after a hang: ${retried.join(', ')}\n`);
process.stdout.write(
    failed.length ? `\nFailed modes: ${failed.join(', ')}\n` : `\nAll ${MODES.length} modes passed.\n`
);
process.exitCode = failed.length ? 1 : 0;
