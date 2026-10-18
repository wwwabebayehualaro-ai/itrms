#!/usr/bin/env node
// Pre-commit secret scan of the staged changes (lefthook.yml). gitleaks is a separate binary
// (https://github.com/gitleaks/gitleaks): when it is installed, its exit code decides; when it is not, the hook says so
// and the CI gitleaks job is the gate. A finding is never swallowed.
import { spawnSync } from 'node:child_process';

const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' });
if (probe.error || probe.status !== 0) {
    console.log('gitleaks is not installed locally; the CI gitleaks job scans this commit.');
    process.exit(0);
}
const scan = spawnSync('gitleaks', ['git', '--pre-commit', '--staged', '--redact', '--no-banner'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
});
process.exit(scan.status ?? 1);
