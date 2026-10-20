// A minimal static server for the built Storybook (storybook-static), so the visual tests need no extra package.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'storybook-static');
const PORT = Number(process.env.PORT ?? 6007);
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon'
};

/** The file a request path names, or null if it is malformed or outside the build directory. */
export function fileFor(urlPath, root = ROOT) {
    let path;
    try {
        path = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
    } catch {
        return null; // malformed escape such as %E0%A4%A
    }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    // inside the directory, not a sibling that merely starts with its name (storybook-static-x)
    return file === root || file.startsWith(root + sep) ? file : null;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    createServer((req, res) => {
        const file = fileFor(req.url ?? '/');
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(file === null ? 400 : 404).end(file === null ? 'bad request' : 'not found');
            return;
        }
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
    }).listen(PORT, '127.0.0.1');
}
