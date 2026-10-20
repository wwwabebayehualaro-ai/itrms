import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fileFor } from './serve.mjs';

const root = resolve('/srv/storybook-static');

describe('the visual tests static server', () => {
    it('serves files inside the build directory', () => {
        expect(fileFor('/', root)).toBe(join(root, 'index.html'));
        expect(fileFor('/assets/a.js?v=1', root)).toBe(join(root, 'assets', 'a.js'));
    });

    it('refuses paths outside it, including a sibling that starts with its name', () => {
        // a plain "/../x" is already resolved by the URL parser to "/x"; a traversal arrives encoded
        expect(fileFor('/../secret.txt', root)).toBe(join(root, 'secret.txt'));
        expect(fileFor('/..%2f..%2fsecret.txt', root)).toBeNull();
        expect(fileFor('/..%2fstorybook-static-x/a.js', root)).toBeNull();
        expect(fileFor('/%2e%2e%2f%2e%2e%2fetc/passwd', root)).toBeNull();
    });

    it('answers a malformed escape instead of crashing', () => {
        expect(fileFor('/%E0%A4%A', root)).toBeNull();
    });
});
