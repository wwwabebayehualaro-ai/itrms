import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
    ALL_JOBS,
    CHECK_STEPS,
    gitleaksRange,
    gitleaksVerdict,
    isPnpmVersion,
    jobRuns,
    pinnedImages,
    renderReport,
    summarise,
    TRIVY_IMAGE
} from './ci-local.mjs';

const yml = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

test('the local checks job runs exactly the commands of ci.yml checks job', () => {
    assert.deepEqual(CHECK_STEPS, jobRuns(yml, 'checks'));
});

test('scanner images come from ci.yml, pinned by digest', () => {
    const images = pinnedImages(yml);
    for (const ref of [images.gitleaks, images.semgrep, TRIVY_IMAGE])
        assert.match(ref, /:[\w.-]+@sha256:[a-f0-9]{64}$/);
});

test('Trivy is never one of the compromised March 2026 builds', () => {
    assert.doesNotMatch(TRIVY_IMAGE, /:0\.69\.[4-6]@/);
});

test('gitleaks passes only when it really scanned commits', () => {
    // The output of the false pass that prompted this check: git failed inside the container, gitleaks still exited 0.
    const broken =
        '7:41AM ERR [git] fatal: not a git repository\n7:41AM INF 0 commits scanned.\n7:41AM INF no leaks found';
    assert.equal(gitleaksVerdict(broken, 0).code, 1);
    assert.equal(gitleaksVerdict('INF 0 commits scanned.\nINF no leaks found', 0).code, 1);
    assert.deepEqual(gitleaksVerdict('INF 3 commits scanned.\nINF no leaks found', 0), {
        code: 0,
        note: '3 commit(s) scanned'
    });
    assert.equal(gitleaksVerdict('INF 1 commits scanned.\nWRN leaks found: 1', 1).code, 1);
});

test('gitleaks scans the whole history of a commit that is already on main, and merge diffs', () => {
    assert.equal(gitleaksRange('abc', 2, false), '-m origin/main..abc');
    assert.equal(gitleaksRange('abc', 0, false), '-m abc');
    assert.equal(gitleaksRange('abc', 2, true), '-m abc');
});

test('a run is a CI record only when every job ran and passed', () => {
    const job = (name, ok = true, skipped = false) => ({ name, ok, skipped });
    assert.deepEqual(summarise(ALL_JOBS.map((n) => job(n))), { complete: true, missing: [], passed: true, ok: true });
    const skippedInfra = summarise(ALL_JOBS.map((n) => job(n, n !== 'infra', n === 'infra')));
    assert.equal(skippedInfra.complete, false);
    assert.equal(skippedInfra.ok, false);
    assert.deepEqual(skippedInfra.missing, ['infra']);
    assert.equal(skippedInfra.passed, true); // the gates that ran passed, but it is still not a record
    assert.equal(summarise([job('semgrep')]).complete, false);
    assert.equal(summarise(ALL_JOBS.map((n) => job(n, n !== 'trivy'))).ok, false);
});

test('only pnpm@x.y.z reaches the container script', () => {
    assert.equal(isPnpmVersion('pnpm@12.9.1'), true);
    for (const bad of ['pnpm@12.9', 'npm@12.9.1', 'pnpm@12.9.1;rm -rf /', 'pnpm@1.2.3@4', 'pnpm@1.2.x'])
        assert.equal(isPnpmVersion(bad), false, bad);
});

test('the report names the commit, the engine, the tool and every job, and marks partial runs', () => {
    const base = {
        sha: 'a'.repeat(40),
        subject: 'x',
        started: 's',
        finished: 'f',
        seconds: 3,
        engine: { version: '29', os: 'linux/amd64', kernel: 'k' },
        tool: { commit: 'b'.repeat(40), dirty: true },
        images: { node: 'node:24' },
        jobs: [{ name: 'checks', ok: true, skipped: false, steps: [{ label: 'lint', code: 0, seconds: 1 }] }],
        evidence: 'e'
    };
    const md = renderReport({ ...base, complete: true });
    assert.match(md, /aaaaaaaaaaaa/);
    assert.match(md, /Docker 29 on linux\/amd64/);
    assert.match(md, /bbbbbbbbbbbb.*uncommitted changes/);
    assert.match(md, /\| checks \| ✓ \| lint: ok/);
    assert.doesNotMatch(md, /partial/);
    assert.match(renderReport({ ...base, complete: false }), /partial: not a CI record/);
});
