#!/usr/bin/env node
// Summarises a Trivy JSON report in CI and checks that Trivy really parsed the workspace's dependencies.
//   node tools/ci/trivy-summary.mjs trivy.json <package that must be listed>...
// Exit 1 when an expected package is missing (Trivy read too little); the vulnerability gate itself is Trivy's
// own exit code.
import { readFileSync } from 'node:fs';

const [file, ...mustList] = process.argv.slice(2);
const results = JSON.parse(readFileSync(file, 'utf8')).Results ?? [];

const findings = results.flatMap((r) =>
    [...(r.Vulnerabilities ?? []), ...(r.Misconfigurations ?? []), ...(r.Secrets ?? [])].map((v) => ({
        target: r.Target,
        id: v.VulnerabilityID ?? v.ID ?? v.RuleID,
        severity: v.Severity,
        what: v.PkgName ? `${v.PkgName} ${v.InstalledVersion} → ${v.FixedVersion || 'no fix'}` : v.Title
    }))
);
for (const f of findings) console.log(`${f.severity.padEnd(8)} ${f.id}  ${f.what}  (${f.target})`);
console.log(`${findings.length} HIGH/CRITICAL finding(s)`);

const listed = new Set(results.flatMap((r) => (r.Packages ?? []).map((p) => p.Name)));
const missing = mustList.filter((name) => !listed.has(name));
if (missing.length) {
    console.error(
        `Trivy did not list ${missing.join(', ')} (${listed.size} packages seen): it did not read pnpm-lock.yaml fully.`
    );
    process.exit(1);
}
console.log(`Trivy listed ${listed.size} packages, including ${mustList.join(', ')}.`);
