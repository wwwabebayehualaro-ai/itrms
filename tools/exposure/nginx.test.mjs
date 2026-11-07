// The public exposure rules of infra/compose/nginx (security.md SEC-WB-1, SEC-ID-4; task 0.10a): what each hostname
// serves and what it never serves. Nginx itself checks the syntax when the production profile starts (task 0.26).
// Run: pnpm test:tools
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const conf = readFileSync(join(ROOT, 'infra', 'compose', 'nginx', 'itrms.conf.template'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

/** The body of the server block for a hostname (the TLS one). */
function server(host) {
    const blocks = conf.split(/\nserver \{/).slice(1);
    const block = blocks.find((b) => b.includes(`server_name ${host};`));
    assert.ok(block, `a server block for ${host}`);
    return block;
}

const app = server('app.${ITRMS_DOMAIN}');
const verify = server('verify.${ITRMS_DOMAIN}');

test("Keycloak's administration and master realm are never public", () => {
    assert.match(app, /location \^~ \/auth\/admin \{ return 404; \}/);
    assert.match(app, /location \^~ \/auth\/realms\/master \{ return 404; \}/);
    // nothing proxies to Keycloak except the itrms realm and its static resources
    const toKeycloak = [...app.matchAll(/location ([^{]+)\{[^}]*proxy_pass http:\/\/keycloak:8080/g)].map((m) =>
        m[1].trim()
    );
    assert.deepEqual(toKeycloak, [
        '^~ /auth/realms/itrms/protocol/openid-connect/auth',
        '^~ /auth/realms/itrms/login-actions/',
        '^~ /auth/realms/itrms/',
        '^~ /auth/resources/'
    ]);
});

test('back-channel logout is reachable only from the internal network', () => {
    assert.match(app, /location = \/auth\/backchannel-logout \{ return 404; \}/);
});

test('sign-in is rate-limited (SEC-ID-4)', () => {
    for (const where of [
        '/auth/realms/itrms/protocol/openid-connect/auth',
        '/auth/realms/itrms/login-actions/',
        '/auth/sign-in'
    ])
        assert.match(
            app,
            new RegExp(`location [^{]*${where.replace(/\//g, '\\/')}[^{]*\\{[^}]*limit_req zone=itrms_signin`)
        );
});

test("the BFF's token calls and the key fetches are not rate-limited (one address for every user)", () => {
    assert.doesNotMatch(app, /location \^~ \/auth\/realms\/itrms\/ \{[^}]*limit_req/);
});

test('an unknown Host is dropped', () => {
    assert.match(conf, /listen 443 ssl default_server;[\s\S]*?return 444;/);
});

test('the API is never exposed but for one public path: the browser reaches it only through the BFF', () => {
    assert.doesNotMatch(app, /proxy_pass http:\/\/api/);
    // the whole configuration names two, on the verify hostname: the public keys (ADR-0046) and a status by its token (ADR-0045)
    assert.equal([...conf.matchAll(/proxy_pass http:\/\/api/g)].length, 2);
    for (const opening of [
        'location = /v1/public/verification-keys {',
        'location ~ "^/v1/public/verifications/[A-Za-z0-9_-]{22}$" {'
    ]) {
        const from = verify.indexOf(opening);
        assert.ok(from > 0, 'the path is exact');
        const block = verify.slice(from, verify.indexOf('\n    }\n', from));
        assert.match(block, /limit_except GET \{ deny all; \}/);
        assert.match(block, /limit_req zone=itrms_verify/);
        assert.match(block, /proxy_pass http:\/\/api:4000;/);
    }
});

test('both hostnames send HSTS and nosniff, and redirect plain HTTP', () => {
    for (const block of [app, verify]) {
        assert.match(block, /Strict-Transport-Security "max-age=63072000; includeSubDomains" always/);
        assert.match(block, /X-Content-Type-Options "nosniff" always/);
    }
    assert.match(conf, /return 301 https:\/\/\$host\$request_uri;/);
});

test('the verify hostname isolates its pages from other origins (SEC-WB-1)', () => {
    assert.match(verify, /Cross-Origin-Opener-Policy "same-origin" always/);
    assert.match(verify, /Cross-Origin-Resource-Policy "same-origin" always/);
});

test('TLS 1.2 offers AEAD suites only, on both hostnames (security.md §11)', () => {
    for (const block of [app, verify]) {
        const ciphers = block.match(/ssl_ciphers ([^;]+);/)?.[1];
        assert.ok(ciphers, 'ssl_ciphers is set');
        for (const suite of ciphers.split(':'))
            assert.match(suite, /^ECDHE-(ECDSA|RSA)-(AES(128|256)-GCM-SHA(256|384)|CHACHA20-POLY1305)$/);
    }
});

test('a verification token is in no access-log line, and a client never chooses the forwarded address or the request id', () => {
    const at = verify.indexOf('location ~ "^/v1/public/verifications/');
    assert.match(verify.slice(at, verify.indexOf('\n    }\n', at)), /access_log \S+ itrms_verification;/);
    assert.match(conf, /log_format itrms_verification [^;]*verifications\/\[redacted\]/);
    const proxy = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'infra', 'compose', 'nginx', 'itrms-proxy.conf'),
        'utf8'
    );
    assert.match(proxy, /proxy_set_header X-Forwarded-For \$remote_addr;/);
    assert.match(proxy, /proxy_set_header X-Request-Id \$request_id;/);
    assert.doesNotMatch(proxy, /proxy_add_x_forwarded_for/);
});

test('the verify hostname serves the static page read-only, and nothing else of the API', () => {
    assert.equal([...verify.matchAll(/proxy_pass/g)].length, 2);
    assert.match(verify, /Permissions-Policy "camera=\(self\), microphone=\(\)/);
    assert.match(verify, /location \/v1\/ \{ return 404; \}/);
    assert.match(verify, /location \^~ \/api\/ \{ return 404; \}/);
    assert.match(verify, /limit_except GET HEAD \{ deny all; \}/);
    // its policy is written at the app's build, by the hash of what the build emitted (ADR-0045)
    assert.match(verify, /include \/srv\/verify\/csp\.conf;/);
    const csp = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'verify', 'scripts', 'csp.mjs'),
        'utf8'
    );
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'none'/);
});

test('files: the object store is reached only through /files, with a presigned URL for one object (task 0.15)', () => {
    // nothing else proxies to the store, and the public verify hostname never does
    const toStore = [
        ...app.matchAll(/location ([^{]+)\{(?:[^{}]|\{[^{}]*\})*?proxy_pass http:\/\/seaweedfs:8333/g)
    ].map((m) => m[1].trim());
    assert.deepEqual(toStore, ['~ ^/files/[a-z0-9.-]+/?$', '~ ^/files/[a-z0-9.-]+/.+']);
    assert.doesNotMatch(verify, /seaweedfs/);
    // the store's root and its bucket listing are refused
    assert.match(app, /location \/files\/ \{ return 403; \}/);
    const bucket = app.match(/location ~ \^\/files\/\[a-z0-9\.-\]\+\/\?\$ \{([\s\S]*?)\n    \}/)?.[1] ?? '';
    assert.match(bucket, /limit_except POST \{ deny all; \}/);
    assert.match(bucket, /if \(\$args != ""\) \{ return 403; \}/);
    // an object only with a signature, never a listing, a multipart start, an ACL or a policy, and only GET and PUT
    const object = app.match(/location ~ \^\/files\/\[a-z0-9\.-\]\+\/\.\+ \{([\s\S]*?)\n    \}/)?.[1] ?? '';
    assert.match(object, /limit_except GET PUT \{ deny all; \}/);
    assert.match(object, /if \(\$args !~ "\(\^\|&\)X-Amz-Signature="\) \{ return 403; \}/);
    for (const op of ['uploads', 'list-type', 'delete', 'acl', 'policy', 'lifecycle'])
        assert.match(object, new RegExp(op));
    // the store sees its own Host (the signature was made for it), and nothing of it goes back
    const proxy = readFileSync(join(ROOT, 'infra', 'compose', 'nginx', 'itrms-s3-proxy.conf'), 'utf8');
    assert.match(proxy, /proxy_set_header Host seaweedfs:8333;/);
    assert.match(proxy, /proxy_hide_header Server;/);
    for (const header of ['Cookie', 'Authorization', 'X-Amz-Copy-Source'])
        assert.match(proxy, new RegExp(`proxy_set_header ${header} "";`));
});
