// The dev stack's secrets file (tools/dev-infra.mjs): generated, kept, validated, owner-only. Run: pnpm test:tools
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ensureEnv, readEnv, SECRET_KEYS } from './dev-infra.mjs';

const dir = mkdtempSync(join(tmpdir(), 'itrms-env-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a new .env gets every secret, letters and digits only', () => {
    const file = join(dir, 'new.env');
    const { created, env } = ensureEnv(file);
    assert.deepEqual(created, SECRET_KEYS);
    for (const k of SECRET_KEYS) assert.match(env[k], /^[a-f0-9]{20,}$/);
    assert.deepEqual(readEnv(file), env);
});

test('existing values, comments and port overrides are kept; only missing keys are appended', () => {
    const file = join(dir, 'kept.env');
    const kept = SECRET_KEYS.filter((k) => k !== 'GRAFANA_ADMIN_PASSWORD').map((k) => `${k}=keep${k.length}`);
    writeFileSync(file, ['# my note', 'PG_HOST_PORT=25432', ...kept].join('\n')); // no trailing newline on purpose
    const { created } = ensureEnv(file);
    assert.deepEqual(created, ['GRAFANA_ADMIN_PASSWORD']);
    const text = readFileSync(file, 'utf8');
    assert.ok(text.startsWith('# my note\nPG_HOST_PORT=25432\n'));
    const env = readEnv(file);
    assert.equal(env.PG_HOST_PORT, '25432');
    assert.equal(env.POSTGRES_PASSWORD, `keep${'POSTGRES_PASSWORD'.length}`);
    assert.match(env.GRAFANA_ADMIN_PASSWORD, /^[a-f0-9]+$/);
    assert.deepEqual(ensureEnv(file).created, []); // idempotent
});

test('a secret with characters that could break SQL or JSON is refused', () => {
    const file = join(dir, 'bad.env');
    writeFileSync(file, `${SECRET_KEYS.map((k) => `${k}=abc`).join('\n')}\nPOSTGRES_PASSWORD=it's"bad\n`);
    assert.throws(() => ensureEnv(file), /POSTGRES_PASSWORD .* letters and digits only/);
});

test('only the owner can read the file', () => {
    const file = join(dir, 'owner.env');
    ensureEnv(file);
    if (process.platform === 'win32') {
        const acl = execFileSync('icacls', [file], { encoding: 'utf8' });
        const grants = acl.split('\n').filter((l) => l.includes(':('));
        assert.equal(grants.length, 1, acl);
        assert.ok(grants[0].includes(process.env.USERNAME ?? ''), acl);
        assert.doesNotMatch(acl, /BUILTIN\\Users|Authenticated Users|Everyone/);
    } else {
        assert.equal(statSync(file).mode & 0o777, 0o600);
    }
});
