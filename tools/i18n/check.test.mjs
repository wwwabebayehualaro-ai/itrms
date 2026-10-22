// The catalogue check fails on what CI must refuse and only reports optional languages (task 0.13).
// Run: pnpm test:tools
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkCatalogues } from './check.mjs';

function tree(files) {
    const root = mkdtempSync(join(tmpdir(), 'itrms-i18n-'));
    for (const [path, content] of Object.entries(files)) {
        const file = join(root, path);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify(content));
    }
    return root;
}

test('a complete repository passes, an optional language is only reported', () => {
    const root = tree({
        'apps/web/messages/am.json': { 'shell.app.name': 'ITRMS' },
        'apps/web/messages/en.json': { 'shell.app.name': 'ITRMS' },
        'apps/web/messages/wal-Latn.json': {},
        'modules/competency/messages/am.json': { 'competency.nav.exams': 'ፈተናዎች' },
        'modules/competency/messages/en.json': { 'competency.nav.exams': 'Exams' }
    });
    try {
        const { problems, notes } = checkCatalogues(root);
        assert.deepEqual(problems, []);
        assert.deepEqual(notes, ['apps/web/messages/wal-Latn.json: 1 of 1 keys fall back to Amharic']);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a missing am or en text, a foreign key and a key that is also a prefix fail', () => {
    const root = tree({
        'modules/competency/messages/am.json': {
            'competency.nav.exams': 'ፈተናዎች',
            'competency.a.b': 'x',
            'competency.a.b.c': 'y'
        },
        'modules/competency/messages/en.json': {
            'competency.nav.exams': '',
            'competency.a.b': 'x',
            'competency.a.b.c': 'y',
            'drivers.nav.list': 'List'
        },
        'modules/competency/messages/wal-Latn.json': { 'competency.extra.key': 'z' }
    });
    try {
        const { problems } = checkCatalogues(root);
        assert.deepEqual(problems.sort(), [
            'modules/competency/messages/wal-Latn.json: "competency.extra.key" is not in am and en',
            'modules/competency/messages: "competency.a.b" is a text and also the prefix of other keys',
            'modules/competency/messages: "competency.nav.exams" has no en text',
            'modules/competency/messages: "drivers.nav.list" belongs to another owner (expected competency.)',
            'modules/competency/messages: "drivers.nav.list" has no am text'
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('every language names the same placeholders as Amharic', () => {
    const root = tree({
        'apps/web/messages/am.json': { 'shell.list.count': '{count} ፋይሎች', 'shell.list.of': '{n} ከ {total}' },
        'apps/web/messages/en.json': {
            'shell.list.count': '{count, plural, one {# file} other {# files}}',
            'shell.list.of': '{n} of {all}'
        },
        'apps/web/messages/wal-Latn.json': { 'shell.list.count': 'fayile' }
    });
    try {
        assert.deepEqual(checkCatalogues(root).problems.sort(), [
            'apps/web/messages: "shell.list.count" names {} in wal-Latn, but {count} in am',
            'apps/web/messages: "shell.list.of" names {all,n} in en, but {n,total} in am'
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
