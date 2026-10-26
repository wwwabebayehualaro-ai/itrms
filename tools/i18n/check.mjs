#!/usr/bin/env node
// The catalogue check (task 0.13, i18n-and-languages.md; CLAUDE.md: keys are required in am and en, CI fails). Walks the
// shell's catalogue (apps/web/messages), every slice's (platform/*/messages, modules/*/messages) and every package
// area's (packages/<pkg>/messages/<area>: the form engine's own words, owned as `<pkg>.<area>.`):
//   - every key in Amharic and English, with a text;
//   - keys are the owner's: `<slice>.<area>.<key>`, the shell's `shell.` or `common.`;
//   - no key is also another's prefix (the web app nests them: `a.b` and `a.b.c` cannot both be texts);
//   - every language's text of a key names the same {placeholders} (a missing one would show nothing, an extra one fail);
//   - optional languages (wal-Latn, om, ti …) missing keys are reported, not failed: they fall back to Amharic.
// Run: pnpm i18n:check
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['am', 'en'];
const KEY = /^[a-z][a-z0-9-]*\.[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/;

/** The arguments a text names (ICU: `{count}`, `{count, plural, …}`), sorted. */
export function placeholdersOf(text) {
    return [...new Set([...text.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))].sort().join(',');
}

/** The catalogue folders of a repository, each with the key prefixes it owns. */
export function catalogueFolders(root) {
    const folders = [];
    const web = join(root, 'apps', 'web', 'messages');
    if (existsSync(web)) folders.push({ dir: web, owners: ['shell', 'common'] });
    for (const layer of ['platform', 'modules']) {
        const base = join(root, layer);
        if (!existsSync(base)) continue;
        for (const slice of readdirSync(base, { withFileTypes: true })) {
            if (!slice.isDirectory() || slice.name.startsWith('_')) continue;
            const dir = join(base, slice.name, 'messages');
            if (existsSync(dir)) folders.push({ dir, owners: [slice.name] });
        }
    }
    const packages = join(root, 'packages');
    if (existsSync(packages))
        for (const pkg of readdirSync(packages, { withFileTypes: true })) {
            const base = join(packages, pkg.name, 'messages');
            if (!pkg.isDirectory() || !existsSync(base)) continue;
            for (const area of readdirSync(base, { withFileTypes: true }))
                if (area.isDirectory())
                    folders.push({ dir: join(base, area.name), owners: [`${pkg.name}.${area.name}`] });
        }
    return folders;
}

/** Problems (fail) and notes (report) of one repository's catalogues. */
export function checkCatalogues(root) {
    const problems = [];
    const notes = [];
    for (const { dir, owners } of catalogueFolders(root)) {
        const where = relative(root, dir).replace(/\\/g, '/');
        const catalogues = {};
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
            try {
                catalogues[file.slice(0, -5)] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
            } catch (e) {
                problems.push(`${where}/${file}: not JSON (${e.message})`);
            }
        }
        for (const language of REQUIRED) if (!catalogues[language]) problems.push(`${where}: no ${language}.json`);
        const keys = new Set(REQUIRED.flatMap((l) => Object.keys(catalogues[l] ?? {})));
        for (const key of [...keys].sort()) {
            if (!KEY.test(key)) problems.push(`${where}: "${key}" is not <owner>.<area>.<key>`);
            else if (!owners.some((o) => key.startsWith(`${o}.`)))
                problems.push(
                    `${where}: "${key}" belongs to another owner (expected ${owners.map((o) => `${o}.`).join(' or ')})`
                );
            for (const language of REQUIRED) {
                const text = catalogues[language]?.[key];
                if (typeof text !== 'string' || text.trim() === '')
                    problems.push(`${where}: "${key}" has no ${language} text`);
            }
            const named = Object.entries(catalogues)
                .filter(([, catalogue]) => typeof catalogue[key] === 'string')
                .map(([language, catalogue]) => [language, placeholdersOf(catalogue[key])]);
            const expected = named.find(([language]) => language === 'am')?.[1];
            for (const [language, args] of named)
                if (expected !== undefined && args !== expected)
                    problems.push(`${where}: "${key}" names {${args}} in ${language}, but {${expected}} in am`);
            if ([...keys].some((other) => other.startsWith(`${key}.`)))
                problems.push(`${where}: "${key}" is a text and also the prefix of other keys`);
        }
        for (const [language, catalogue] of Object.entries(catalogues)) {
            if (REQUIRED.includes(language)) continue;
            for (const key of Object.keys(catalogue))
                if (!keys.has(key)) problems.push(`${where}/${language}.json: "${key}" is not in am and en`);
            const missing = [...keys].filter((k) => !catalogue[k]).length;
            if (missing) notes.push(`${where}/${language}.json: ${missing} of ${keys.size} keys fall back to Amharic`);
        }
    }
    return { problems, notes };
}

/** Run as a script (not imported by the tests): compared as real paths, so a drive letter's case or a link cannot skip it. */
const isMain = () => {
    try {
        return (
            Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
        );
    } catch {
        return false;
    }
};

if (isMain()) {
    const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const { problems, notes } = checkCatalogues(root);
    for (const note of notes) console.log(`  note: ${note}`);
    if (problems.length) {
        for (const p of problems) console.error(`  ✖ ${p}`);
        console.error(`i18n:check: ${problems.length} problem(s)`);
        process.exit(1);
    }
    console.log(`✔ catalogues complete in am and en (${catalogueFolders(root).length} folders)`);
}
