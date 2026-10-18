// The slice generator and the uniformity check agree: a freshly rendered slice passes the check, and a broken one
// is reported. Run: pnpm test:tools
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { sliceProblems } from '../check-slices.mjs';
import { renderSlice } from './slice.mjs';

const KEY = 'zz-scaffold-test';
const dir = renderSlice({
    key: KEY,
    layer: 'work-process',
    summary: 'Scaffold test slice "quoted" C:\\path',
    deps: ['kernel', 'drivers']
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('a rendered slice follows the slice shape', () => {
    assert.deepEqual(sliceProblems(dir), []);
});

test('placeholders are filled in every file', () => {
    const manifest = readFileSync(join(dir, 'module.ts'), 'utf8');
    assert.match(manifest, /key: 'zz-scaffold-test'/);
    assert.match(manifest, /layer: 'work-process'/);
    assert.match(manifest, /dependsOn: \['kernel', 'drivers'\]/);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    // A backslash and quotes must survive: escaped in package.json, written as typed in the README.
    assert.equal(pkg.description, 'Scaffold test slice "quoted" C:\\path');
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /Scaffold test slice "quoted" C:\\path/);
});

test('rendering refuses to overwrite an existing slice', () => {
    assert.throws(() => renderSlice({ key: KEY, layer: 'work-process', summary: 'again' }), /already exists/);
});

test('rendering refuses a key that is not kebab-case', () => {
    assert.throws(() => renderSlice({ key: 'Bad_Key', layer: 'registry', summary: 'x' }), /kebab-case/);
});

test('the check reports a slice whose exports drift', () => {
    const file = join(dir, 'package.json');
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    delete pkg.exports['./seed'];
    pkg.scripts.test = 'vitest';
    writeFileSync(file, JSON.stringify(pkg));
    const problems = sliceProblems(dir);
    assert.ok(problems.some((p) => p.includes('exports["./seed"]')));
    assert.ok(problems.some((p) => p.includes('scripts.test')));
});

test('rendering refuses a name used by another package in the workspace', () => {
    assert.throws(
        () => renderSlice({ key: 'kernel', layer: 'work-process', summary: 'x' }),
        /already exists elsewhere/
    );
});

test('rendering refuses invalid dependsOn entries and multi-line summaries', () => {
    assert.throws(
        () => renderSlice({ key: 'zz-a', layer: 'registry', summary: 'x', deps: ["kernel', evil: '"] }),
        /dependsOn/
    );
    assert.throws(() => renderSlice({ key: 'zz-b', layer: 'registry', summary: 'line one\nline two' }), /one line/);
});
