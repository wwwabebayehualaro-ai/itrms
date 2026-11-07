// The git guard (tools/hooks/guard-git.mjs): what it denies, what it lets through, and what it leaves to the permission flow (it never asks).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), 'guard-git.mjs');

function decision(command) {
    const run = spawnSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
        encoding: 'utf8'
    });
    assert.equal(run.status, 0);
    return run.stdout ? JSON.parse(run.stdout).hookSpecificOutput.permissionDecision : null;
}

test('a push to origin on its own goes ahead', () => {
    for (const command of [
        'git push origin main',
        'git push -u origin task/x',
        'git push --set-upstream origin a',
        'git push -q origin HEAD',
        'git push -q origin main',
        'git push --quiet -u origin task/x',
        'git push origin HEAD:main',
        'git push origin --delete task/x',
        'git push origin :task/x'
    ])
        assert.equal(decision(command), 'allow', command);
});

test('a force-push is denied, however it is written', () => {
    for (const command of [
        'git push --force',
        'git push -f origin main',
        'git push origin +main',
        'git push --force-with-lease'
    ])
        assert.equal(decision(command), 'deny', command);
});

test('a push that could send the code elsewhere, or delete main, is denied (never asked)', () => {
    for (const command of [
        'git push another main',
        'git push https://example.com/x.git main',
        'git push --mirror origin',
        'git push --all origin',
        'git -c remote.origin.pushurl=https://example.com/x.git push origin main',
        'git -c core.sshCommand=evil push origin main',
        'GIT_SSH_COMMAND=evil git push origin main',
        'git push origin :main',
        'git push origin --delete main'
    ])
        assert.equal(decision(command), 'deny', command);
    assert.equal(decision('git add . && git push another main'), 'deny');
    assert.equal(decision('git -C "a b" push --force origin main'), 'deny');
});

test('a push it cannot place is left to the normal permission flow, never asked', () => {
    for (const command of ['git push', 'git push -q', 'git -C elsewhere push origin main', 'rm -rf x git push origin'])
        assert.equal(decision(command), null, command);
});

test('an approval never covers anything else in the command', () => {
    for (const command of [
        'rm -rf x; git push origin main',
        'git push origin main && rm -rf x',
        'git push origin $(whoami)',
        'git push origin main > out'
    ])
        assert.notEqual(decision(command), 'allow', command);
});

test('what bypasses checks or destroys work stays denied', () => {
    for (const command of ['git commit --no-verify -m x', 'git reset --hard', 'git clean -fd'])
        assert.equal(decision(command), 'deny', command);
    assert.equal(decision('git status'), null);
    assert.equal(decision('git commit -m "mentions --no-verify in words"'), null);
});
