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
    deps: ['kernel', 'drivers'],
    titleAm: "የሙከራ ክፍል 'ቅንጭብ'",
    workProcess: '4'
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
    // what @itrms/module-sdk requires of a work process: a title (Amharic, the summary as English) and its number
    assert.ok(
        manifest.includes(String.raw`title: { am: 'የሙከራ ክፍል \'ቅንጭብ\'', en: 'Scaffold test slice "quoted" C:\\path' }`)
    );
    assert.match(manifest, /workProcess: 4\n/);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    // A backslash and quotes must survive: escaped in package.json, written as typed in the README.
    assert.equal(pkg.description, 'Scaffold test slice "quoted" C:\\path');
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /Scaffold test slice "quoted" C:\\path/);
});

test('rendering refuses to overwrite an existing slice', () => {
    assert.throws(() => renderSlice({ key: KEY, layer: 'work-process', summary: 'again' }), /already exists/);
});

test('rendering asks a registry or work process for its title, and a work process for its number', () => {
    assert.throws(() => renderSlice({ key: 'zz-c', layer: 'registry', summary: 'x' }), /Amharic title/);
    assert.throws(
        () => renderSlice({ key: 'zz-d', layer: 'work-process', summary: 'x', titleAm: 'ሀ', workProcess: '11' }),
        /work process, 1 to 10/
    );
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

test('the check refuses a platform slice that is not in the platform order', () => {
    const extra = renderSlice({ key: 'zz-unordered', layer: 'platform', summary: 'Not in PLATFORM_ORDER' });
    try {
        assert.ok(sliceProblems(extra).some((p) => p.includes('not in the platform order')));
    } finally {
        rmSync(extra, { recursive: true, force: true });
    }
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

test('the check ties the manifest layer and dependsOn to where the slice lives', () => {
    const file = join(dir, 'module.ts');
    const original = readFileSync(file, 'utf8');
    try {
        writeFileSync(file, original.replace("layer: 'work-process'", "layer: 'registry'"));
        assert.ok(sliceProblems(dir).some((p) => p.includes("must declare layer: 'work-process'")));
        writeFileSync(
            file,
            original.replace("dependsOn: ['kernel', 'drivers']", "dependsOn: ['kernel', 'competency']")
        );
        assert.ok(sliceProblems(dir).some((p) => p.includes('dependsOn "competency" goes against the layer order')));
    } finally {
        writeFileSync(file, original);
    }
});
