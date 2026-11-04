// The verify app's Content-Security-Policy, written at its build (ADR-0032, ADR-0045). A static export has no per-request nonce,
// so each inline script the build emitted is allowed by its hash and nothing else may run. Nginx includes the result on
// `verify.<domain>`. Run after `next build`.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

const htmlFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return htmlFiles(path);
        return entry.name.endsWith('.html') ? [path] : [];
    });

const hashes = new Set();
for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, 'utf8');
    for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/\bsrc=/.test(attributes) || body === '') continue;
        hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
}

const policy = [
    "default-src 'none'",
    `script-src 'self' ${[...hashes].sort().join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
].join('; ');

writeFileSync(join(OUT, 'csp.conf'), `add_header Content-Security-Policy "${policy}" always;\n`);
process.stdout.write(`csp.conf: ${hashes.size} inline script(s) allowed by hash\n`);
