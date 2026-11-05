/**
 * Serves the built app as Nginx does on `verify.<domain>`: the same fallback, the build's own policy, the same public paths. It can
 * go away entirely, which is what flight mode has to survive.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2'
};

export interface Answers {
    keys: () => unknown;
    /** a token's status, or nothing for no such document */
    verification: (token: string) => unknown;
}

export async function serve(out: string, answers: Answers) {
    const policy = /Content-Security-Policy "([^"]+)"/.exec(readFileSync(join(out, 'csp.conf'), 'utf8'))?.[1];
    if (!policy) throw new Error('the build wrote no policy');
    let away = false;
    const server = createServer((request, response) => {
        if (away) {
            request.socket.destroy();
            return;
        }
        // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- a test's own server, and an anchored fixed-length pattern
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        const json = (status: number, body: unknown) => {
            response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            response.end(JSON.stringify(body));
        };
        if (path === '/v1/public/verification-keys') return json(200, answers.keys());
        const token = /^\/v1\/public\/verifications\/([A-Za-z0-9_-]{22})$/.exec(path)?.[1];
        if (token) {
            const answer = answers.verification(token);
            return answer ? json(200, answer) : json(404, {});
        }
        if (path.startsWith('/v1/')) return json(404, {});
        const tried = [path, `${path}.html`, '/index.html'].map((p) => join(out, normalize(p)));
        const file = tried.find((p) => existsSync(p) && statSync(p).isFile()) ?? join(out, 'index.html');
        response.writeHead(200, {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            'content-security-policy': policy,
            'cache-control': 'no-cache'
        });
        response.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
    return {
        origin: `http://localhost:${(server.address() as AddressInfo).port}`,
        goAway: () => {
            away = true;
            server.closeAllConnections();
        },
        comeBack: () => {
            away = false;
        },
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(resolve);
            })
    };
}
