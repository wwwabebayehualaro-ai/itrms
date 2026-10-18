#!/usr/bin/env node
// Licence report of every installed dependency (ADR-0025: recorded, not a gate). CI uploads it as an artefact.
//   node tools/licences-report.mjs [out.md]      default: licences-report.md
// Licences outside the permissive set are listed first so a reviewer sees them; the exit code is always 0.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PERMISSIVE = new Set([
    'MIT',
    'ISC',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    '0BSD',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'Unlicense',
    'Python-2.0',
    'CC-BY-4.0'
]);

const out = process.argv[2] ?? 'licences-report.md';
const json = execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024
});
const byLicence = JSON.parse(json);

const rows = Object.entries(byLicence)
    .flatMap(([licence, pkgs]) => pkgs.map((p) => ({ licence, name: p.name, versions: p.versions.join(', ') })))
    .sort((a, b) => a.name.localeCompare(b.name));
const review = rows.filter((r) => !PERMISSIVE.has(r.licence));
const totals = Object.entries(byLicence)
    .map(([licence, pkgs]) => [licence, pkgs.length])
    .sort((a, b) => b[1] - a[1]);

const table = (list) => [
    '| Package | Version | Licence |',
    '|---|---|---|',
    ...list.map((r) => `| ${r.name} | ${r.versions} | ${r.licence} |`)
];
const md = [
    `# Licence report (${new Date().toISOString().slice(0, 10)})`,
    '',
    `${rows.length} packages. Totals: ${totals.map(([l, n]) => `${l} ${n}`).join(' · ')}.`,
    '',
    '## For review (not in the permissive set)',
    '',
    ...(review.length ? table(review) : ['None.']),
    '',
    '## All packages',
    '',
    ...table(rows),
    ''
].join('\n');

writeFileSync(out, md, 'utf8');
console.log(
    `${out}: ${rows.length} packages, ${review.length} for review (${review.map((r) => `${r.name} ${r.licence}`).join(', ') || 'none'})`
);
