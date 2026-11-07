// The production profile on one machine (task 0.26a, ADR-0008): its settings and certificates, the stack from the images, the
// database roles, the bucket and Keycloak's realm, the migrations and, for a demo installation, the demo's data; then a smoke
// check over TLS on its hostnames. CI runs it (the production-profile job); docs/operations/installation.md is the runbook.
//
//   node tools/prod-stack.mjs up [--demo]     start it (builds the images when ITRMS_VERSION is unset: `local`)
//   node tools/prod-stack.mjs smoke           the checks, over TLS, as a browser on the network sees it
//   node tools/prod-stack.mjs backup [--type full|diff]   a backup now (the repository host also takes them nightly)
//   node tools/prod-stack.mjs drill [--probe] the restore drill: the latest backup restored into a scratch database, checked
//                                             against the live one (--probe: first a write only the archived WAL holds; CI)
//   node tools/prod-stack.mjs down [--volumes]
//
// Settings: infra/compose/.env.production (generated, secrets, owner-only, never committed). Certificates: infra/compose/tls
// (app.*, verify.* and the CA the processes trust); a test installation gets a self-signed set, a bureau puts its own there.
// Backups (task 0.26b1): pgBackRest, its repository host pulling over mutual TLS with certificates from infra/compose/backup-tls.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as plainRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'infra', 'compose');
const ENV = join(DIR, '.env.production');
const OVERLAY = join(DIR, 'production.yml');
const TLS = join(DIR, 'tls');
const BACKUP_TLS = join(DIR, 'backup-tls');
const DRILL_REPORTS = join(DIR, 'drill-reports');

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
        KEYCLOAK_BASE_PATH: '/auth',
        // the backup repository's encryption key: lost with the settings file, the backups are unreadable (keep its copy)
        PGBACKREST_CIPHER_PASS: env.PGBACKREST_CIPHER_PASS ?? randomBytes(32).toString('base64url')
    };
    const missing = Object.entries(derived).filter(([k]) => env[k] === undefined);
    if (missing.length) appendFileSync(ENV, missing.map(([k, v]) => `${k}=${v}\n`).join(''));
    return { ...derived, ...env };
}

/**
 * A CA and the certificates it signs, made in a scratch folder and moved into place once all are signed; the CA's key is then
 * deleted, so nothing else can be issued under it. A complete set is kept. A partial one (a bureau's set missing a file) stops
 * the start with what it lacks rather than being overwritten.
 */
function issue(dir, { ca, days, bits, leaves }) {
    const outputs = ['ca.pem', ...leaves.flatMap((leaf) => [leaf.key, leaf.cert])];
    const missing = outputs.filter((file) => !existsSync(join(dir, file)));
    if (missing.length === 0) return false;
    if (missing.length < outputs.length)
        throw new Error(`${dir} is incomplete (no ${missing.join(', ')}): complete it, or empty it for a new test set`);
    const work = `${dir}.new`;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const ssl = (...args) => execFileSync('openssl', args, { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
    ssl(
        'req',
        '-x509',
        '-newkey',
        `rsa:${bits}`,
        '-nodes',
        '-days',
        String(days),
        '-subj',
        `/CN=${ca}`,
        '-keyout',
        'ca.key',
        '-out',
        'ca.pem',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign'
    );
    for (const [i, leaf] of leaves.entries()) {
        writeFileSync(join(work, `${i}.ext`), `subjectAltName=DNS:${leaf.cn}\nextendedKeyUsage=${leaf.usage}\n`);
        ssl(
            'req',
            '-newkey',
            `rsa:${bits}`,
            '-nodes',
            '-subj',
            `/CN=${leaf.cn}`,
            '-keyout',
            leaf.key,
            '-out',
            `${i}.csr`
        );
        ssl(
            'x509',
            '-req',
            '-in',
            `${i}.csr`,
            '-CA',
            'ca.pem',
            '-CAkey',
            'ca.key',
            '-CAcreateserial',
            '-days',
            String(days),
            '-extfile',
            `${i}.ext`,
            '-out',
            `${i}.crt`
        );
        const signed = readFileSync(join(work, `${i}.crt`), 'utf8');
        writeFileSync(join(work, leaf.cert), leaf.chain ? signed + readFileSync(join(work, 'ca.pem'), 'utf8') : signed);
    }
    mkdirSync(dir, { recursive: true });
    for (const file of outputs) renameSync(join(work, file), join(dir, file));
    // the CA's key, the requests and the serial go with the scratch folder
    rmSync(work, { recursive: true, force: true });
    return true;
}

/** A self-signed set for a test installation: a CA, and the app's and the verifier's certificates it signs. */
function certificates() {
    const leaves = ['app', 'verify'].map((name) => ({
        cn: `${name}.${DOMAIN}`,
        usage: 'serverAuth',
        key: `${name}.key.pem`,
        cert: `${name}.fullchain.pem`,
        chain: true
    }));
    if (issue(TLS, { ca: 'ITRMS test CA', days: 30, bits: 2048, leaves }))
        console.log(`  test certificates for app.${DOMAIN} and verify.${DOMAIN} (infra/compose/tls)`);
}

/**
 * The backups' own CA (not the one the processes trust) and the three identities it signs: the database, the repository host
 * and the drill's scratch database. Each pgBackRest server accepts only the names it lists (infra/docker/pgbackrest.sh), and
 * each container mounts only its own key. On site the database machine keeps ca.pem and postgres.*, the backup machine
 * ca.pem, backup.* and drill.*.
 */
function backupCertificates() {
    const leaves = ['postgres', 'backup', 'drill'].map((name) => ({
        cn: name,
        usage: 'serverAuth,clientAuth',
        key: `${name}.key`,
        cert: `${name}.crt`,
        chain: false
    }));
    if (issue(BACKUP_TLS, { ca: 'ITRMS backup CA', days: 825, bits: 3072, leaves }))
        console.log('  backup certificates (infra/compose/backup-tls)');
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
    backupCertificates();
    if (!VERSION) compose(['--profile', 'setup', 'build']);
    // and the gates: the setup reaches Keycloak's administration through `admin`, the processes the store through `s3`
    // and the repository host, which the database archives its WAL to
    const backing = ['postgres', 'backup', 'valkey-queues', 'valkey-sessions', 'keycloak', 'seaweedfs', 'admin', 's3'];
    compose(['up', '-d', '--wait', '--wait-timeout', '300', ...backing]);
    dev.seedDatabaseRoles(env);
    // the WAL to the repository (kept in postgresql.auto.conf, so a restored database archives again), the stanza (an
    // existing one is checked and kept), then that the WAL reaches it
    sql(
        'postgres',
        `ALTER SYSTEM SET archive_command = 'pgbackrest --stanza=itrms archive-push %p';\nSELECT pg_reload_conf();`
    );
    repository('stanza-create');
    repository('check');
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

/** pgBackRest on the repository host, as its user. */
const repository = (...args) =>
    compose(['exec', '-T', '-u', 'pgbackrest', 'backup', 'pgbackrest', '--stanza=itrms', ...args]);

/** SQL as the superuser, on the live database or the drill's, by psql over the container's socket; its one output line. */
const sql = (service, text, database = 'itrms') =>
    String(
        compose(
            [
                'exec',
                '-T',
                service,
                'psql',
                '-X',
                '-q',
                '-At',
                '-v',
                'ON_ERROR_STOP=1',
                '-U',
                'postgres',
                '-d',
                database
            ],
            {
                input: text,
                stdio: ['pipe', 'pipe', 'inherit'],
                encoding: 'utf8'
            }
        )
    ).trim();

/** The rows of every table of a database (none: an empty object). */
const TABLES = `coalesce((
    SELECT json_object_agg(t.name, t.rows ORDER BY t.name)
    FROM (
      SELECT format('%I.%I', n.nspname, c.relname) AS name,
             (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
    ) t
  ), '{}'::json)`;

/**
 * What the drill compares, in one snapshot: the rows of every table (the business tables, the registries, the cases, the
 * kernel's), and the audit log's rows with a digest over them in order (its hash chain, once it has one, is checked the same way).
 * On the live database the same statement makes the restore point the drill recovers to: the snapshot and the point are the
 * same moment, so the restored database matches exactly, however busy the live one is (`point`: its name).
 */
const state = (point) => `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT json_build_object(
  ${point ? `'point', pg_create_restore_point('${point}')::text,` : ''}
  'tables', ${TABLES},
  'audit', (SELECT json_build_object('rows', count(*), 'digest', md5(coalesce(string_agg(md5(a::text), '' ORDER BY a.id), '')))
            FROM kernel.audit_log a)
);
COMMIT;`;

/** Keycloak's database (the users, their second factors) is in the same backup: its tables' rows are compared too. */
const KEYCLOAK_STATE = `SELECT json_build_object('tables', ${TABLES});`;

async function backup(type) {
    if (!['full', 'diff'].includes(type)) throw new Error(`a backup is full or diff, not ${type}`);
    const from = Date.now();
    repository(`--type=${type}`, 'backup');
    console.log(`  ${type} backup in ${((Date.now() - from) / 1000).toFixed(1)} s`);
    repository('info');
}

async function drill(probe) {
    if (probe) {
        // a write after the last backup: the drill finds it only by replaying the archived WAL
        sql(
            'postgres',
            `CREATE SCHEMA IF NOT EXISTS itrms_drill;
CREATE TABLE IF NOT EXISTS itrms_drill.probe (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
INSERT INTO itrms_drill.probe DEFAULT VALUES;`
        );
    }
    // Keycloak's first (its own snapshot: a sign-in in between differs by a session), then ITRMS's with the restore point
    const keycloak = JSON.parse(sql('postgres', KEYCLOAK_STATE, 'keycloak'));
    const point = `itrms-drill-${Date.now()}`;
    const live = JSON.parse(sql('postgres', state(point)));
    // the restore point's WAL in the repository (check switches to a new segment and waits for the old one to be archived)
    repository('check');
    const from = Date.now();
    let restored;
    let restoredKeycloak;
    try {
        compose(['--profile', 'drill', 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', '21600', 'drill'], {
            env: { ...process.env, DRILL_TARGET: point }
        });
        // open once it is consistent, before it reaches the restore point: until it is promoted
        const recovering = () => {
            try {
                return sql('drill', 'SELECT pg_is_in_recovery();') !== 'f';
            } catch {
                return true;
            }
        };
        for (const until = Date.now() + 6 * 3600_000; recovering();) {
            if (Date.now() > until) throw new Error('the drill database did not finish its recovery');
            await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        restored = JSON.parse(sql('drill', state()));
        restoredKeycloak = JSON.parse(sql('drill', KEYCLOAK_STATE, 'keycloak'));
    } finally {
        // the scratch database and its volume are gone again, whatever happened: it holds a copy of the personal data
        compose(['--profile', 'drill', 'rm', '-f', '-s', '-v', 'drill']);
        execFileSync('docker', ['volume', 'rm', '-f', 'itrms_drill-data'], { stdio: 'ignore' });
    }
    console.log(`  restored and recovered to ${point} in ${((Date.now() - from) / 1000).toFixed(1)} s`);

    const problems = [];
    const names = new Set([...Object.keys(live.tables), ...Object.keys(restored.tables)]);
    let rows = 0;
    for (const name of [...names].sort()) {
        const [a, b] = [live.tables[name], restored.tables[name]];
        if (a !== b) problems.push(`${name}: ${a ?? 'missing'} live, ${b ?? 'missing'} restored`);
        rows += b ?? 0;
    }
    if (live.audit.rows !== restored.audit.rows || live.audit.digest !== restored.audit.digest)
        problems.push(
            `the audit log: ${live.audit.rows} rows live, ${restored.audit.rows} restored, digests ${live.audit.digest === restored.audit.digest ? 'equal' : 'differ'}`
        );
    // a restore of nothing would match an empty database: the drill needs something to have been backed up
    if (rows === 0 || restored.audit.rows === 0) problems.push('the restored database is empty');
    if (probe && !(restored.tables['itrms_drill.probe'] > 0))
        problems.push('the write after the backup was not replayed');
    const keycloakNames = new Set([...Object.keys(keycloak.tables), ...Object.keys(restoredKeycloak.tables)]);
    for (const name of [...keycloakNames].sort()) {
        const [a, b] = [keycloak.tables[name], restoredKeycloak.tables[name]];
        if (a !== b) problems.push(`keycloak ${name}: ${a ?? 'missing'} live, ${b ?? 'missing'} restored`);
    }
    if (keycloakNames.size === 0) problems.push("the restored database has no Keycloak's tables");

    // ADR-0012's report: what was compared, kept beside the installation (counts and digests, no personal data)
    mkdirSync(DRILL_REPORTS, { recursive: true });
    const at = new Date().toISOString();
    const report = join(DRILL_REPORTS, `${at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(
        report,
        JSON.stringify(
            { at, point, passed: problems.length === 0, problems, live, restored, keycloak, restoredKeycloak },
            null,
            2
        )
    );
    console.log(`  the report: ${report}`);
    if (problems.length) {
        console.error(`The restore drill failed:\n  ${problems.join('\n  ')}`);
        process.exit(1);
    }
    console.log(
        `The restore drill passed: ${names.size} tables, ${rows} rows and ${restored.audit.rows} audit rows as live; Keycloak's ${keycloakNames.size} tables too.`
    );
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
        console.log(`  ${ok ? 'âœ“' : 'âœ—'} ${name}${kind ? ` (${kind})` : ''}`);
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
else if (command === 'backup') {
    const at = flags.indexOf('--type');
    await backup(at >= 0 ? (flags[at + 1] ?? '') : 'full');
} else if (command === 'drill') await drill(flags.includes('--probe'));
else if (command === 'down')
    compose(['--profile', 'setup', 'down', ...(flags.includes('--volumes') ? ['--volumes'] : [])]);
else {
    console.error(
        'usage: node tools/prod-stack.mjs up [--demo] | smoke | backup [--type full|diff] | drill [--probe] | down [--volumes]'
    );
    process.exit(1);
}
