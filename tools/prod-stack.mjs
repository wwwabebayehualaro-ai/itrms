// The production profile on one machine (task 0.26a, ADR-0008): its settings and certificates, the stack from the images, the
// database roles, the bucket and Keycloak's realm, the migrations and, for a demo installation, the demo's data; then a smoke
// check over TLS on its hostnames. CI runs it (the production-profile job); docs/operations/installation.md is the runbook.
//
//   node tools/prod-stack.mjs up [--demo]     start it (builds the images when ITRMS_VERSION is unset: `local`)
//   node tools/prod-stack.mjs smoke           the checks, over TLS, as a browser on the network sees it
//   node tools/prod-stack.mjs down [--volumes]
//
// Settings: infra/compose/.env.production (generated, secrets, owner-only, never committed). Certificates: infra/compose/tls
// (app.*, verify.* and the CA the processes trust); a test installation gets a self-signed set, a bureau puts its own there.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as plainRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'infra', 'compose');
const ENV = join(DIR, '.env.production');
const OVERLAY = join(DIR, 'production.yml');
const TLS = join(DIR, 'tls');

// dev-infra's helpers, pointed at this profile's settings and Compose file
process.env.ITRMS_ENV_FILE = ENV;
process.env.ITRMS_COMPOSE_OVERLAY = OVERLAY;
const dev = await import('./dev-infra.mjs');
const { demoSteps } = await import('./demo-reset.mjs');

// what the operator set in the settings file wins (Compose reads it from there), then this run's environment
const fileSettings = existsSync(ENV) ? dev.readEnv(ENV) : {};
const setting = (key, fallback) => fileSettings[key] ?? process.env[key] ?? fallback;
const DOMAIN = setting('ITRMS_DOMAIN', 'itrms.test');
const VERSION = setting('ITRMS_VERSION', undefined);

const compose = (args, options = {}) =>
    execFileSync(
        'docker',
        ['compose', '-f', join(DIR, 'docker-compose.yml'), '-f', OVERLAY, '--env-file', ENV, ...args],
        {
            cwd: DIR,
            stdio: 'inherit',
            ...options
        }
    );

/** The secrets (as development's, generated once), and what the processes read derived from them. */
function settings() {
    const { env } = dev.ensureEnv(ENV);
    const derived = {
        ITRMS_DOMAIN: DOMAIN,
        FIELD_KEYS: `k1:${Buffer.from(env.FIELD_KEK, 'hex').toString('base64')}`,
        SESSION_KEYS: `k1:${Buffer.from(env.BFF_SESSION_KEY, 'hex').toString('base64')}`,
        S3_BUCKET: 'itrms',
        // Keycloak serves under /auth here (KC_HTTP_RELATIVE_PATH): its admin API too
        KEYCLOAK_BASE_PATH: '/auth'
    };
    const missing = Object.entries(derived).filter(([k]) => env[k] === undefined);
    if (missing.length) appendFileSync(ENV, missing.map(([k, v]) => `${k}=${v}\n`).join(''));
    return { ...derived, ...env };
}

/** A self-signed set for a test installation: a CA, and the app's and the verifier's certificates it signs. */
function certificates() {
    if (existsSync(join(TLS, 'ca.pem'))) return;
    mkdirSync(TLS, { recursive: true });
    const ssl = (...args) => execFileSync('openssl', args, { cwd: TLS, stdio: ['ignore', 'ignore', 'inherit'] });
    ssl(
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '30',
        '-subj',
        '/CN=ITRMS test CA',
        '-keyout',
        'ca.key',
        '-out',
        'ca.pem',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign'
    );
    for (const name of ['app', 'verify']) {
        const host = `${name}.${DOMAIN}`;
        writeFileSync(join(TLS, `${name}.ext`), `subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\n`);
        ssl(
            'req',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-subj',
            `/CN=${host}`,
            '-keyout',
            `${name}.key.pem`,
            '-out',
            `${name}.csr`
        );
        ssl(
            'x509',
            '-req',
            '-in',
            `${name}.csr`,
            '-CA',
            'ca.pem',
            '-CAkey',
            'ca.key',
            '-CAcreateserial',
            '-days',
            '30',
            '-extfile',
            `${name}.ext`,
            '-out',
            `${name}.crt`
        );
        writeFileSync(
            join(TLS, `${name}.fullchain.pem`),
            readFileSync(join(TLS, `${name}.crt`), 'utf8') + readFileSync(join(TLS, 'ca.pem'), 'utf8')
        );
    }
    // the CA's key signed these two and is gone: nothing else can be issued under the CA the processes trust
    for (const file of ['ca.key', 'ca.srl', 'app.csr', 'verify.csr', 'app.ext', 'verify.ext', 'app.crt', 'verify.crt'])
        rmSync(join(TLS, file), { force: true });
    console.log(`  test certificates for app.${DOMAIN} and verify.${DOMAIN} (infra/compose/tls)`);
}

/**
 * Keycloak in production mode answers its health check before its first admin exists ("Bootstrap in progress", 503): its
 * admin token is asked for only once its master realm answers.
 */
async function keycloakReady(env, timeoutMs = 300_000) {
    const url = `http://127.0.0.1:${env.KEYCLOAK_HOST_PORT ?? 18080}/auth/realms/master`;
    const until = Date.now() + timeoutMs;
    for (;;) {
        const status = await fetch(url).then(
            (r) => r.status,
            () => 0
        );
        if (status === 200) return;
        if (Date.now() > until) throw new Error(`Keycloak did not answer at ${url} (last status ${status})`);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
}

/** A seed or the migrations, in the setup container (the API image, with the owner's connection). */
const inSetup = (_settings, script, args) =>
    compose([
        '--profile',
        'setup',
        'run',
        '--rm',
        '-T',
        'setup',
        'node',
        '--enable-source-maps',
        `dist/${script}`,
        ...args
    ]);

async function up(demo) {
    const env = settings();
    certificates();
    if (!VERSION) compose(['--profile', 'setup', 'build']);
    const backing = ['postgres', 'valkey-queues', 'valkey-sessions', 'keycloak', 'seaweedfs'];
    compose(['up', '-d', '--wait', '--wait-timeout', '300', ...backing]);
    dev.seedDatabaseRoles(env);
    // the bucket, from inside the store (its S3 port is on the stack's network only); an existing one stays
    compose(['exec', '-T', 'seaweedfs', 'sh', '-c', `echo "s3.bucket.create -name ${env.S3_BUCKET}" | weed shell`], {
        stdio: ['ignore', 'ignore', 'inherit']
    });
    await keycloakReady(env);
    await dev.seedKeycloak(env, {
        appOrigin: `https://app.${DOMAIN}`,
        // Keycloak tells the BFF of a sign-out on the stack's own network
        backchannel: 'http://web:3000',
        displayName: 'ITRMS',
        devUsers: false,
        demoAccounts: demo
    });
    const started = Date.now();
    if (demo) {
        // the demo from nothing, as `pnpm demo:reset` makes it (its first step is the migrations)
        for (const [name, run] of demoSteps(inSetup)) {
            const from = Date.now();
            run();
            console.log(`  ${name}: ${((Date.now() - from) / 1000).toFixed(1)} s`);
        }
    } else {
        compose(['--profile', 'setup', 'run', '--rm', '-T', 'migrate']);
    }
    console.log(`  migrated${demo ? ' and seeded the demo' : ''} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    compose(['up', '-d', '--wait', '--wait-timeout', '300']);
    console.log(`The installation is up: https://app.${DOMAIN} and https://verify.${DOMAIN}`);
}

/** A request to the stack's Nginx on this machine, for a hostname, as a browser that trusts the installation's CA. */
function get(host, path, { tls = true } = {}) {
    const ca = readFileSync(join(TLS, 'ca.pem'));
    const port = tls ? Number(setting('ITRMS_HTTPS_PORT', 443)) : Number(setting('ITRMS_HTTP_PORT', 80));
    return new Promise((resolve, reject) => {
        const req = (tls ? request : plainRequest)(
            { host: '127.0.0.1', port, path, servername: host, headers: { host }, ca, timeout: 30_000 },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
            }
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`${host}${path}: no answer`)));
        req.end();
    });
}

/** Whether a call out from the API's container fails: through the egress proxy (`proxied`), or straight out. */
function blockedOut(proxied) {
    const code =
        "fetch('https://example.com', { signal: AbortSignal.timeout(15000) }).then(() => process.exit(1), () => process.exit(0))";
    try {
        compose(['exec', '-T', '-e', `NODE_USE_ENV_PROXY=${proxied ? '1' : '0'}`, 'api', 'node', '-e', code], {
            stdio: 'ignore'
        });
        return true;
    } catch {
        return false;
    }
}

async function smoke() {
    const app = `app.${DOMAIN}`;
    const verify = `verify.${DOMAIN}`;
    const checks = [
        ['http goes to https', async () => (await get(app, '/', { tls: false })).status === 301],
        [
            'the verification page',
            async () => {
                const r = await get(verify, '/');
                return r.status === 200 && r.body.includes('<html');
            }
        ],
        [
            'the verification keys, from the API through Nginx',
            async () => {
                const r = await get(verify, '/v1/public/verification-keys');
                return r.status === 200 && Array.isArray(JSON.parse(r.body).keys);
            }
        ],
        [
            'the API only through the app on the verify host: refused',
            async () => (await get(verify, '/api/v1/cases')).status === 404
        ],
        [
            'sign-in goes to Keycloak on the app host',
            async () => {
                const r = await get(app, '/auth/sign-in');
                const to = String(r.headers.location ?? '');
                if (r.status !== 303 || !to.startsWith(`https://${app}/auth/realms/itrms/protocol/openid-connect/auth`))
                    return false;
                const login = await get(app, to.slice(`https://${app}`.length));
                return login.status === 200 && login.body.includes('kc-login');
            }
        ],
        ['Keycloak administration is not public', async () => (await get(app, '/auth/admin/')).status === 404],
        ['the API has no route out of its own', async () => blockedOut(false)],
        ['the egress proxy refuses a host the installation did not allow', async () => blockedOut(true)],
        [
            'security headers',
            async () => {
                const r = await get(app, '/auth/error');
                return /max-age=\d+/.test(String(r.headers['strict-transport-security'] ?? ''));
            }
        ]
    ];
    let failed = 0;
    for (const [name, check] of checks) {
        let ok = false;
        // the kind of failure only (a refused connection, an untrusted certificate): the logs step has the rest
        let kind = '';
        try {
            ok = await check();
        } catch (error) {
            kind = String((error && typeof error === 'object' && 'code' in error && error.code) || 'no answer');
        }
        console.log(`  ${ok ? '✓' : '✗'} ${name}${kind ? ` (${kind})` : ''}`);
        if (!ok) failed += 1;
    }
    if (failed) {
        console.error(`${failed} of ${checks.length} smoke checks failed.`);
        process.exit(1);
    }
    console.log(`All ${checks.length} smoke checks passed.`);
}

const [command = 'up', ...flags] = process.argv.slice(2);
if (command === 'up') await up(flags.includes('--demo'));
else if (command === 'smoke') await smoke();
else if (command === 'down')
    compose(['--profile', 'setup', 'down', ...(flags.includes('--volumes') ? ['--volumes'] : [])]);
else {
    console.error('usage: node tools/prod-stack.mjs up [--demo] | smoke | down [--volumes]');
    process.exit(1);
}
