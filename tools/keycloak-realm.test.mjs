// The ITRMS realm's security settings (infra/compose/keycloak/realm-itrms.json), which tools/dev-infra.mjs applies to every
// installation's Keycloak. Run: pnpm test:tools
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const realm = JSON.parse(
    readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'compose', 'keycloak', 'realm-itrms.json'),
        'utf8'
    )
);

test('no self-service account recovery: a mailbox alone never resets a password or a second factor (SEC-ID-8)', () => {
    // security review 0.26c1 A3: recovery is an administrator's, confirmed by a second one
    assert.equal(realm.resetPasswordAllowed, false);
});

test('no self-registration, and brute-force protection on', () => {
    assert.equal(realm.registrationAllowed, false);
    assert.equal(realm.bruteForceProtected, true);
});
