#!/usr/bin/env node
// The development stack (phase-0 task 0.3, infra/compose/docker-compose.yml).
//
//   pnpm dev:infra [--observability]   create .env (random secrets) on first run, start, wait until ready, seed
//   pnpm dev:infra:check               prove it works: seeds present, storage isolated, telemetry round trip
//   pnpm dev:infra:status              container health
//   pnpm dev:infra:down                stop (data is kept)
//   pnpm dev:infra:reset --yes         stop and delete all local dev data (volumes)
//
// Secrets never enter git: infra/compose/.env is ignored, generated here and readable only by its owner. Seeding is
// idempotent. Only `up` ever writes secrets.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(ROOT, 'infra', 'compose', 'docker-compose.yml');
const ENV_FILE = join(ROOT, 'infra', 'compose', '.env');

/** Every secret the stack needs; .env.example lists the same keys without values. */
export const SECRET_KEYS = [
    'POSTGRES_PASSWORD',
    'KEYCLOAK_DB_PASSWORD',
    'KEYCLOAK_ADMIN_PASSWORD',
    // the itrms-web client's secret (the BFF, task 0.10a)
    'KEYCLOAK_WEB_CLIENT_SECRET',
    // the itrms-identity-admin service account (org units → groups, task 0.10a)
    'KEYCLOAK_IDENTITY_ADMIN_SECRET',
    // the BFF's AES-256-GCM session key (32 bytes, hex)
    'BFF_SESSION_KEY',
    // personal data (task 0.14): the audit log's HMAC key for masked fields, the key-encryption key of the field
    // encryption (32 bytes, hex) and the blind indexes' HMAC key
    'AUDIT_HMAC_KEY',
    'FIELD_KEK',
    'BLIND_INDEX_KEY',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'GLITCHTIP_DB_PASSWORD',
    'GLITCHTIP_SECRET_KEY',
    'GRAFANA_ADMIN_PASSWORD',
    'DEV_USER_PASSWORD',
    // the ITRMS database roles (platform/kernel/api/db/sql/roles.psql)
    'ITRMS_OWNER_PASSWORD',
    'ITRMS_APP_PASSWORD',
    'ITRMS_SYSTEM_PASSWORD',
    'ITRMS_BACKUP_PASSWORD'
];
/** Secrets are written into SQL (as psql variables) and into SeaweedFS's JSON config: letters and digits only. */
const SECRET_VALUE = /^[A-Za-z0-9]+$/;

export const BUCKETS = ['itrms-dev', 'itrms-test'];
export const DEV_USERS = [
    { username: 'dev.admin', firstName: 'Dev', lastName: 'Admin' },
    { username: 'dev.officer', firstName: 'Dev', lastName: 'Officer' },
    { username: 'dev.cashier', firstName: 'Dev', lastName: 'Cashier' }
];

/**
 * Host ports (127.0.0.1). The defaults are an ITRMS range so they do not collide with a native PostgreSQL or other
 * local stacks; any of them can be overridden in infra/compose/.env. They are checked before starting.
 */
export const PORT_DEFAULTS = {
    PG_HOST_PORT: 15432,
    VALKEY_QUEUES_HOST_PORT: 16379,
    VALKEY_SESSIONS_HOST_PORT: 16380,
    KEYCLOAK_HOST_PORT: 18080,
    S3_HOST_PORT: 18333,
    SMTP_HOST_PORT: 11025,
    MAILPIT_HOST_PORT: 18025
};
export const OBSERVABILITY_PORT_DEFAULTS = {
    OTLP_GRPC_HOST_PORT: 14317,
    OTLP_HTTP_HOST_PORT: 14318,
    ALLOY_HOST_PORT: 12345,
    PROMETHEUS_HOST_PORT: 19090,
    LOKI_HOST_PORT: 13100,
    TEMPO_HOST_PORT: 13200,
    GRAFANA_HOST_PORT: 13001,
    GLITCHTIP_HOST_PORT: 18000
};

export function ports(env) {
    const all = { ...PORT_DEFAULTS, ...OBSERVABILITY_PORT_DEFAULTS };
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Number(env[k] ?? v)]));
}

export function readEnv(file = ENV_FILE) {
    const env = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) env[m[1]] = m[2];
    }
    return env;
}

/** Only the owner may read the secrets: icacls on Windows (mode bits are ignored there), chmod elsewhere. */
function restrictToOwner(file) {
    if (process.platform === 'win32') {
        execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' });
    } else {
        chmodSync(file, 0o600);
    }
}

/**
 * Creates the .env file with random secrets, or appends keys that a newer stack needs. Everything already in the file
 * (values, port overrides, comments) is kept as it is.
 */
export function ensureEnv(file = ENV_FILE) {
    const existed = existsSync(file);
    const env = existed ? readEnv(file) : {};
    const bad = SECRET_KEYS.filter((k) => env[k] && !SECRET_VALUE.test(env[k]));
    if (bad.length) {
        throw new Error(`${bad.join(', ')} in infra/compose/.env must be letters and digits only`);
    }
    const missing = SECRET_KEYS.filter((k) => !env[k]);
    if (missing.length) {
        const lines = missing.map((k) => {
            env[k] = randomBytes(
                k === 'S3_ACCESS_KEY' ? 10 : k === 'BFF_SESSION_KEY' || k === 'FIELD_KEK' ? 32 : 24
            ).toString('hex');
            return `${k}=${env[k]}`;
        });
        const header = existed
            ? ''
            : '# Generated by tools/dev-infra.mjs for the local development stack only. Never commit; never reuse.\n' +
              '# Port overrides may be added below, e.g. PG_HOST_PORT=25432 (see infra/compose/README.md).\n';
        const separator = existed && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '';
        appendFileSync(file, `${header}${separator}${lines.join('\n')}\n`, 'utf8');
    }
    restrictToOwner(file);
    return { created: missing, env };
}

function stackVolumes() {
    return execFileSync('docker', ['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=itrms'], {
        encoding: 'utf8'
    })
        .split('\n')
        .filter(Boolean);
}

/**
 * Runs docker compose. Without a .env (only for down/status/reset), placeholders satisfy the compose file's required
 * variables: nothing is written, and no service starts with them.
 */
function compose(args, { observability = false } = {}) {
    const profile = observability ? ['--profile', 'observability'] : [];
    const hasEnv = existsSync(ENV_FILE);
    const placeholders = hasEnv ? {} : Object.fromEntries(SECRET_KEYS.map((k) => [k, 'placeholder']));
    execFileSync(
        'docker',
        ['compose', '-f', COMPOSE, ...(hasEnv ? ['--env-file', ENV_FILE] : []), ...profile, ...args],
        { stdio: 'inherit', env: { ...process.env, ...placeholders } }
    );
}

/** Resolves to false when something else already listens on 127.0.0.1:port. */
function portFree(port) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
}

/** Ports of the stack's own running containers are fine; any other listener is a conflict. */
async function assertPortsFree(env, observability) {
    const running = execFileSync(
        'docker',
        ['ps', '--filter', 'label=com.docker.compose.project=itrms', '--format', '{{.Ports}}'],
        { encoding: 'utf8' }
    );
    const keys = Object.keys(observability ? { ...PORT_DEFAULTS, ...OBSERVABILITY_PORT_DEFAULTS } : PORT_DEFAULTS);
    const p = ports(env);
    const busy = [];
    for (const k of keys) {
        if (running.includes(`127.0.0.1:${p[k]}->`)) continue;
        if (!(await portFree(p[k]))) busy.push(`${k}=${p[k]}`);
    }
    if (busy.length) {
        throw new Error(
            `port(s) already in use on 127.0.0.1: ${busy.join(', ')}. Stop the other program, or set another port in infra/compose/.env`
        );
    }
}

/**
 * Readiness checked from the host after `compose up --wait`: services whose images can't run a healthcheck
 * (distroless Loki and Tempo; no HTTP client in Alloy and GlitchTip). It also proves the host port binding works.
 * GlitchTip is probed on a page that reads its database, so missing migrations show up here.
 */
const READINESS = [
    ['Loki', 'LOKI_HOST_PORT', '/ready', (body) => body.trim() === 'ready'],
    ['Tempo', 'TEMPO_HOST_PORT', '/ready', (body) => body.trim() === 'ready'],
    ['Alloy', 'ALLOY_HOST_PORT', '/-/ready', () => true],
    ['GlitchTip', 'GLITCHTIP_HOST_PORT', '/api/settings/', (body) => body.trim().startsWith('{')]
];

async function waitReady(env, timeoutMs = 180_000) {
    const p = ports(env);
    const deadline = Date.now() + timeoutMs;
    for (const [name, key, path, ok] of READINESS) {
        let last = '';
        for (;;) {
            try {
                const res = await fetch(`http://127.0.0.1:${p[key]}${path}`, { signal: AbortSignal.timeout(3000) });
                const body = await res.text();
                if (res.ok && ok(body)) break;
                last = `${res.status} ${body.slice(0, 80)}`;
            } catch (e) {
                last = e.message;
            }
            if (Date.now() > deadline) throw new Error(`${name} is not ready (${last.trim()})`);
            await new Promise((r) => setTimeout(r, 2000));
        }
        console.log(`  ${name} ready`);
    }
}

function s3Client(env) {
    return new S3Client({
        endpoint: `http://127.0.0.1:${ports(env).S3_HOST_PORT}`,
        region: 'us-east-1',
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
    });
}

async function seedBuckets(env) {
    const s3 = s3Client(env);
    for (const Bucket of BUCKETS) {
        try {
            await s3.send(new HeadBucketCommand({ Bucket }));
        } catch {
            await s3.send(new CreateBucketCommand({ Bucket }));
            console.log(`  bucket ${Bucket} created`);
        }
    }
    s3.destroy();
}

async function keycloak(env, path, { token, method = 'GET', body, form } = {}) {
    const res = await fetch(`http://127.0.0.1:${ports(env).KEYCLOAK_HOST_PORT}${path}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
        },
        body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined
    });
    if (!res.ok && res.status !== 404 && res.status !== 409) {
        throw new Error(`Keycloak ${method} ${path} → ${res.status} ${await res.text()}`);
    }
    return res;
}

async function keycloakToken(env) {
    const res = await keycloak(env, '/realms/master/protocol/openid-connect/token', {
        method: 'POST',
        form: {
            grant_type: 'password',
            client_id: 'admin-cli',
            username: 'admin',
            password: env.KEYCLOAK_ADMIN_PASSWORD
        }
    });
    return (await res.json()).access_token;
}

/**
 * The authentication flows of the realm file (a top-level flow, its sub-flows and their executions), created in an
 * existing realm: a realm update does not import flows. A flow that exists is left as it is.
 */
async function ensureFlows(env, token, flows) {
    const base = '/admin/realms/itrms/authentication';
    const byAlias = new Map(flows.map((f) => [f.alias, f]));
    // what a flow should look like: each execution's level, authenticator (or sub-flow) and requirement
    const wanted = (flow, level = 0) =>
        [...flow.authenticationExecutions]
            .sort((a, b) => a.priority - b.priority)
            .flatMap((e) => {
                const sub = e.authenticatorFlow ? byAlias.get(e.flowAlias) : undefined;
                const row = `${level}:${sub ? sub.alias : e.authenticator}:${e.requirement}`;
                return sub ? [row, ...wanted(sub, level + 1)] : [row];
            });
    const existing = new Map(
        (await (await keycloak(env, `${base}/flows`, { token })).json()).map((f) => [f.alias, f.id])
    );
    for (const flow of flows.filter((f) => f.topLevel && existing.has(f.alias))) {
        const path = `${base}/flows/${encodeURIComponent(flow.alias)}/executions`;
        const actual = (await (await keycloak(env, path, { token })).json()).map(
            (e) => `${e.level}:${e.authenticationFlow ? e.displayName : e.providerId}:${e.requirement}`
        );
        if (actual.join('|') === wanted(flow).join('|')) continue;
        // changed in the realm file: unbind it, delete it with its sub-flows, and build it again below
        await keycloak(env, '/admin/realms/itrms', { token, method: 'PUT', body: { browserFlow: 'browser' } });
        await keycloak(env, `${base}/flows/${existing.get(flow.alias)}`, { token, method: 'DELETE' });
        existing.delete(flow.alias);
        console.log(`  flow "${flow.alias}" changed: replaced`);
    }
    for (const flow of flows.filter((f) => f.topLevel && !existing.has(f.alias))) {
        await keycloak(env, `${base}/flows`, {
            token,
            method: 'POST',
            body: {
                alias: flow.alias,
                description: flow.description,
                providerId: 'basic-flow',
                topLevel: true,
                builtIn: false
            }
        });
        const fill = async (parent) => {
            const path = `${base}/flows/${encodeURIComponent(parent.alias)}/executions`;
            for (const e of [...parent.authenticationExecutions].sort((a, b) => a.priority - b.priority)) {
                const sub = e.authenticatorFlow ? byAlias.get(e.flowAlias) : undefined;
                await keycloak(env, sub ? `${path}/flow` : `${path}/execution`, {
                    token,
                    method: 'POST',
                    body: sub
                        ? {
                              alias: sub.alias,
                              description: sub.description,
                              provider: 'registration-page-form',
                              type: 'basic-flow'
                          }
                        : { provider: e.authenticator }
                });
                // the new execution is the last one of this flow's own level
                const listed = await (await keycloak(env, path, { token })).json();
                const level = Math.min(...listed.map((x) => x.level));
                const added = listed.filter((x) => x.level === level).at(-1);
                await keycloak(env, path, { token, method: 'PUT', body: { ...added, requirement: e.requirement } });
                if (sub) await fill(sub);
            }
        };
        await fill(flow);
        console.log(`  flow "${flow.alias}" created`);
    }
}

/** The generated demo users of the API's seed (apps/api/seed/users/*.demo.yaml), with the same account ids. */
function demoUsers() {
    const dir = join(ROOT, 'apps', 'api', 'seed', 'users');
    return readdirSync(dir)
        .filter((f) => f.endsWith('.demo.yaml'))
        .flatMap((f) => parseYaml(readFileSync(join(dir, f), 'utf8')).users);
}

/**
 * The ITRMS realm from infra/compose/keycloak/realm-itrms.json (settings, password and brute-force policy, the sign-in
 * flow with a required second factor, the clients), brought up to date on every start; the dev users and the demo users
 * of the API's seed (same ids as their ITRMS users), each asked to set up TOTP at the first sign-in.
 */
async function seedKeycloak(env) {
    const token = await keycloakToken(env);
    const realm = JSON.parse(readFileSync(join(ROOT, 'infra', 'compose', 'keycloak', 'realm-itrms.json'), 'utf8'));
    const secrets = {
        'itrms-web': env.KEYCLOAK_WEB_CLIENT_SECRET,
        'itrms-identity-admin': env.KEYCLOAK_IDENTITY_ADMIN_SECRET
    };
    const clients = realm.clients.map((c) => (secrets[c.clientId] ? { ...c, secret: secrets[c.clientId] } : c));
    const { authenticationFlows, requiredActions, browserFlow, ...rest } = realm;
    const settings = { ...rest, clients: undefined, displayName: 'ITRMS (development)' };
    if ((await keycloak(env, '/admin/realms/itrms', { token })).status === 404) {
        await keycloak(env, '/admin/realms', { token, method: 'POST', body: { ...realm, ...settings, clients } });
        console.log('  realm itrms created');
    } else {
        await keycloak(env, '/admin/realms/itrms', { token, method: 'PUT', body: settings });
        await ensureFlows(env, token, authenticationFlows);
        await keycloak(env, '/admin/realms/itrms', { token, method: 'PUT', body: { browserFlow } });
        for (const action of requiredActions) {
            const path = `/admin/realms/itrms/authentication/required-actions/${action.alias}`;
            if ((await keycloak(env, path, { token })).status === 404)
                await keycloak(env, '/admin/realms/itrms/authentication/register-required-action', {
                    token,
                    method: 'POST',
                    body: { providerId: action.providerId, name: action.name }
                });
            await keycloak(env, path, { token, method: 'PUT', body: action });
        }
        await keycloak(env, '/admin/realms/itrms/partialImport', {
            token,
            method: 'POST',
            body: { ifResourceExists: 'OVERWRITE', clients }
        });
    }
    await grantIdentityAdmin(env, token);

    const credentials = [{ type: 'password', value: env.DEV_USER_PASSWORD, temporary: false }];
    const users = [
        ...DEV_USERS.map((u) => ({ ...u, email: `${u.username}@example.test` })),
        ...demoUsers().map((u) => ({
            id: u.keycloakSub,
            username: u.username,
            // Keycloak's name check refuses brackets: "Zone Head (demo)" becomes Zone Head / Demo
            firstName: u.displayName.replace(/\s*\(demo\)\s*$/, ''),
            lastName: 'Demo',
            email: `${u.username}@example.test`
        }))
    ].map((u) => ({ ...u, enabled: true, emailVerified: true, credentials, requiredActions: ['CONFIGURE_TOTP'] }));
    // SKIP: a developer's TOTP set-up survives the next start
    const res = await keycloak(env, '/admin/realms/itrms/partialImport', {
        token,
        method: 'POST',
        body: { ifResourceExists: 'SKIP', users }
    });
    const added = (await res.json()).added ?? 0;
    if (added) console.log(`  ${added} user(s) created`);
}

/**
 * The identity-admin service account manages the realm's users and groups. `manage-users` also lets it reset any
 * account's credentials, so its secret is as sensitive as the admin password (narrowing it: a follow-up).
 */
async function grantIdentityAdmin(env, token) {
    const clientId = async (name) =>
        (await (await keycloak(env, `/admin/realms/itrms/clients?clientId=${name}`, { token })).json())[0]?.id;
    const admin = await clientId('itrms-identity-admin');
    const management = await clientId('realm-management');
    const account = await (
        await keycloak(env, `/admin/realms/itrms/clients/${admin}/service-account-user`, { token })
    ).json();
    const roles = [];
    for (const name of ['manage-users', 'view-users', 'query-users', 'query-groups'])
        roles.push(
            await (await keycloak(env, `/admin/realms/itrms/clients/${management}/roles/${name}`, { token })).json()
        );
    await keycloak(env, `/admin/realms/itrms/users/${account.id}/role-mappings/clients/${management}`, {
        token,
        method: 'POST',
        body: roles
    });
}

/**
 * The local settings the API and the BFF read in development, derived from infra/compose/.env (git-ignored, owner-only
 * like it): apps/api/.env.http.local, .env.worker.local and .env.migrate.local (`node --env-file`), apps/web/.env.local
 * (Next.js).
 */
function writeAppEnv(env) {
    const p = ports(env);
    const issuer = `http://localhost:${p.KEYCLOAK_HOST_PORT}/realms/itrms`;
    const pg = (role) =>
        `postgres://itrms_${role}:${env[`ITRMS_${role.toUpperCase()}_PASSWORD`]}@127.0.0.1:${p.PG_HOST_PORT}/itrms`;
    const personalData = {
        AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY,
        FIELD_KEYS: `dev:${Buffer.from(env.FIELD_KEK, 'hex').toString('base64')}`,
        BLIND_INDEX_KEY: env.BLIND_INDEX_KEY
    };
    const files = {
        [join(ROOT, 'apps', 'api', '.env.http.local')]: {
            NODE_ENV: 'development',
            DATABASE_URL: pg('app'),
            ...personalData,
            PORT: '4000',
            OIDC_ISSUER: issuer
        },
        [join(ROOT, 'apps', 'api', '.env.migrate.local')]: {
            NODE_ENV: 'development',
            DATABASE_MIGRATE_URL: pg('owner'),
            KEYCLOAK_URL: `http://localhost:${p.KEYCLOAK_HOST_PORT}`,
            KEYCLOAK_ADMIN_CLIENT_SECRET: env.KEYCLOAK_IDENTITY_ADMIN_SECRET
        },
        [join(ROOT, 'apps', 'api', '.env.worker.local')]: {
            NODE_ENV: 'development',
            DATABASE_URL: pg('app'),
            DATABASE_SYSTEM_URL: pg('system'),
            ...personalData,
            VALKEY_QUEUES_URL: `redis://127.0.0.1:${p.VALKEY_QUEUES_HOST_PORT}/0`,
            KEYCLOAK_URL: `http://localhost:${p.KEYCLOAK_HOST_PORT}`,
            KEYCLOAK_ADMIN_CLIENT_SECRET: env.KEYCLOAK_IDENTITY_ADMIN_SECRET
        },
        [join(ROOT, 'apps', 'web', '.env.local')]: {
            APP_ORIGIN: 'http://localhost:3000',
            API_URL: 'http://127.0.0.1:4000',
            OIDC_ISSUER: issuer,
            OIDC_CLIENT_ID: 'itrms-web',
            OIDC_CLIENT_SECRET: env.KEYCLOAK_WEB_CLIENT_SECRET,
            SESSION_VALKEY_URL: `redis://127.0.0.1:${p.VALKEY_SESSIONS_HOST_PORT}/0`,
            SESSION_KEYS: `dev:${Buffer.from(env.BFF_SESSION_KEY, 'hex').toString('base64')}`
        }
    };
    for (const [file, values] of Object.entries(files)) {
        const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
        writeFileSync(
            file,
            `# Written by pnpm dev:infra from infra/compose/.env. Never commit.\n${lines.join('\n')}\n`,
            'utf8'
        );
        restrictToOwner(file);
    }
    console.log('  app settings: apps/api/.env.{http,worker,migrate}.local, apps/web/.env.local');
}

async function up(observability) {
    if (!existsSync(ENV_FILE) && stackVolumes().length) {
        throw new Error(
            'infra/compose/.env is missing but the stack’s data volumes exist: the secrets they were created with are ' +
                'lost, so the services could not log in to each other. Run `pnpm dev:infra:reset --yes` (deletes the ' +
                'local dev data), then `pnpm dev:infra`.'
        );
    }
    const { created, env } = ensureEnv();
    if (created.length) console.log(`infra/compose/.env: generated ${created.length} secret(s)`);
    await assertPortsFree(env, observability);
    const p = ports(env);
    compose(['up', '-d', '--wait', '--wait-timeout', '300'], { observability });
    if (observability) await waitReady(env);
    console.log('Seeding:');
    seedDatabaseRoles(env);
    await seedBuckets(env);
    await seedKeycloak(env);
    writeAppEnv(env);
    console.log(`
Development stack is healthy.
  PostgreSQL   127.0.0.1:${p.PG_HOST_PORT}  database itrms (users postgres, itrms_owner, itrms_app, itrms_system)
  Valkey       127.0.0.1:${p.VALKEY_QUEUES_HOST_PORT} (queues) · 127.0.0.1:${p.VALKEY_SESSIONS_HOST_PORT} (sessions)
  Keycloak     http://localhost:${p.KEYCLOAK_HOST_PORT}  realm itrms · users ${DEV_USERS.map((u) => u.username).join(', ')}
  S3           http://127.0.0.1:${p.S3_HOST_PORT}  buckets ${BUCKETS.join(', ')}
  Mailpit      http://127.0.0.1:${p.MAILPIT_HOST_PORT}  (SMTP 127.0.0.1:${p.SMTP_HOST_PORT})${
      observability
          ? `
  Grafana      http://127.0.0.1:${p.GRAFANA_HOST_PORT} · GlitchTip http://127.0.0.1:${p.GLITCHTIP_HOST_PORT} · OTLP 127.0.0.1:${p.OTLP_GRPC_HOST_PORT}/${p.OTLP_HTTP_HOST_PORT}`
          : ''
  }
Passwords and keys are in infra/compose/.env. Check it end to end: pnpm dev:infra:check`);
}

/**
 * Creates or updates the ITRMS database roles with the kernel's bootstrap (roles.psql), as the postgres superuser. It runs
 * on every `up`, so a stack whose volume predates the roles gets them too. The passwords go in on stdin, as psql
 * variables, never on a command line.
 */
function seedDatabaseRoles(env) {
    const roles = ['owner', 'app', 'system', 'backup'];
    const variables = roles.map((r) => `\\set ${r}_password '${env[`ITRMS_${r.toUpperCase()}_PASSWORD`]}'\n`).join('');
    const bootstrap = readFileSync(join(ROOT, 'platform', 'kernel', 'api', 'db', 'sql', 'roles.psql'), 'utf8');
    execFileSync(
        'docker',
        [
            'compose',
            '-f',
            COMPOSE,
            '--env-file',
            ENV_FILE,
            'exec',
            '-T',
            'postgres',
            'psql',
            '-q',
            '-v',
            'ON_ERROR_STOP=1',
            '-U',
            'postgres',
            '-d',
            'itrms'
        ],
        { input: variables + bootstrap, stdio: ['pipe', 'ignore', 'inherit'] }
    );
    console.log(`  PostgreSQL roles: ${roles.map((r) => `itrms_${r}`).join(', ')}`);
}

/** Runs `bash -c script` in a stack container; true when it exits 0. */
function inContainer(container, script) {
    try {
        execFileSync('docker', ['exec', container, 'bash', '-c', script], { stdio: 'ignore', timeout: 15_000 });
        return true;
    } catch {
        return false;
    }
}

/** Sends an OTLP log and trace to Alloy and waits until Loki and Tempo have them. */
async function telemetryRoundTrip(p) {
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const nowNs = `${BigInt(Date.now()) * 1_000_000n}`;
    const marker = `itrms-check-${traceId.slice(0, 8)}`;
    const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'itrms-dev-check' } }] };
    const post = (path, body) =>
        fetch(`http://127.0.0.1:${p.OTLP_HTTP_HOST_PORT}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
    await post('/v1/logs', {
        resourceLogs: [
            {
                resource,
                scopeLogs: [
                    { logRecords: [{ timeUnixNano: nowNs, body: { stringValue: `${marker} ሰላም` }, traceId, spanId }] }
                ]
            }
        ]
    });
    await post('/v1/traces', {
        resourceSpans: [
            {
                resource,
                scopeSpans: [
                    {
                        spans: [
                            {
                                traceId,
                                spanId,
                                name: 'dev-check',
                                kind: 1,
                                startTimeUnixNano: nowNs,
                                endTimeUnixNano: nowNs
                            }
                        ]
                    }
                ]
            }
        ]
    });
    let inLoki = false;
    let inTempo = false;
    for (let i = 0; i < 30 && !(inLoki && inTempo); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!inLoki) {
            const q = new URLSearchParams({
                query: `{service_name="itrms-dev-check"} |= "${marker}"`,
                start: `${Date.now() - 600_000}000000`
            });
            const j = await (await fetch(`http://127.0.0.1:${p.LOKI_HOST_PORT}/loki/api/v1/query_range?${q}`)).json();
            inLoki = (j.data?.result ?? []).length > 0;
        }
        if (!inTempo) inTempo = (await fetch(`http://127.0.0.1:${p.TEMPO_HOST_PORT}/api/traces/${traceId}`)).ok;
    }
    return { inLoki, inTempo };
}

/** Proof that the running stack works, not only that its containers run. Exit 1 when any check fails. */
async function check() {
    if (!existsSync(ENV_FILE)) throw new Error('no infra/compose/.env: run pnpm dev:infra first');
    const env = readEnv();
    const p = ports(env);
    const results = [];
    const record = (ok, what) => results.push({ ok, what });

    const s3 = s3Client(env);
    for (const Bucket of BUCKETS) {
        record(
            await s3.send(new HeadBucketCommand({ Bucket })).then(
                () => true,
                () => false
            ),
            `S3 bucket ${Bucket}`
        );
    }
    s3.destroy();

    const token = await keycloakToken(env);
    for (const u of DEV_USERS) {
        const res = await keycloak(env, `/admin/realms/itrms/users?exact=true&username=${u.username}`, { token });
        record(res.ok && (await res.json()).length === 1, `Keycloak user ${u.username} in realm itrms`);
    }

    // Storage isolation: SeaweedFS's unauthenticated filer is unreachable from other containers (control: postgres is).
    record(
        inContainer('itrms-keycloak-1', 'exec 3<>/dev/tcp/postgres/5432'),
        'control: keycloak reaches postgres:5432'
    );
    record(
        !inContainer('itrms-keycloak-1', 'exec 3<>/dev/tcp/seaweedfs/8888'),
        'keycloak cannot reach the SeaweedFS filer'
    );

    const observability = execFileSync('docker', ['ps', '-q', '--filter', 'name=itrms-alloy-1'], {
        encoding: 'utf8'
    }).trim();
    if (observability) {
        const { inLoki, inTempo } = await telemetryRoundTrip(p);
        record(inLoki, 'OTLP log through Alloy is in Loki');
        record(inTempo, 'OTLP trace through Alloy is in Tempo');
        const gt = await fetch(`http://127.0.0.1:${p.GLITCHTIP_HOST_PORT}/api/settings/`);
        record(gt.ok, 'GlitchTip reads its database (/api/settings/)');
    } else {
        console.log('  (observability profile not running: telemetry checks skipped)');
    }

    for (const r of results) console.log(`  ${r.ok ? '✔' : '✖'} ${r.what}`);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) throw new Error(`${failed} of ${results.length} checks failed`);
    console.log(`All ${results.length} checks passed.`);
}

// The command line runs only when this file is executed, never when it is imported (tests import ensureEnv).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [cmd = 'up', ...rest] = process.argv.slice(2);
    try {
        if (cmd === 'up') await up(rest.includes('--observability'));
        else if (cmd === 'check') await check();
        else if (cmd === 'down') compose(['--profile', 'observability', 'down']);
        else if (cmd === 'status') compose(['--profile', 'observability', 'ps']);
        else if (cmd === 'reset') {
            if (!rest.includes('--yes'))
                throw new Error('reset deletes all local dev data (volumes). Re-run with --yes.');
            compose(['--profile', 'observability', 'down', '--volumes']);
        } else throw new Error(`Unknown command "${cmd}" (up | check | status | down | reset --yes)`);
    } catch (e) {
        console.error(`dev-infra: ${e.message}`);
        process.exit(1);
    }
}
