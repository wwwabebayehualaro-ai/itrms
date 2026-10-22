#!/usr/bin/env node
// Local Linux CI (ADR-0034): the jobs of .github/workflows/ci.yml, run in Linux containers on this machine against a clean
// copy of one commit. The record it writes is the CI evidence while GitHub-hosted runners are unavailable.
//
//   pnpm ci:local [--ref <commit>] [--jobs checks,infra,gitleaks,trivy,semgrep] [--full-history]
//
// * checks    clones the commit inside node:<.nvmrc>-bookworm and runs the steps of ci.yml's `checks` job, then the
//             licence report (not a gate)
// * infra     the dev stack and the S3 contract suite; the services are Linux containers, the test runner is this machine.
//             It runs only when --ref is HEAD and the working tree is clean, because it uses this checkout
// * gitleaks  the pinned image from ci.yml, over the commits not yet on origin/main, or the whole history up to the commit
//             when it is already there (or with --full-history)
// * trivy     pinned image (below), the same options as ci.yml, then the commit's tools/ci/trivy-summary.mjs
// * semgrep   the pinned image from ci.yml, the same rule sets
//
// Everything that decides how a commit is tested (.nvmrc, packageManager, ci.yml) is read from that commit, not from the
// working tree. Only a run of every job is a complete record: it writes .ci-local/<sha>/report.md and report.json. A run of
// some jobs, or one with a skipped job, writes report-partial.* and never replaces the complete record. Exit 1 if a gate
// that ran failed.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Trivy is not an image in ci.yml (it runs through trivy-action), so its image is pinned here. 0.75.0 is an immutable,
 * signed GitHub release (2026-10-01), well after the compromised 0.69.4–0.69.6 builds of March 2026. Docker Hub and GHCR
 * serve the same digest. Renovate updates it (renovate.json, custom manager).
 */
export const TRIVY_IMAGE =
    'aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa';
const TRIVY_SKIP_DIRS = 'Backend,contracts,features,tools/boundaries/fixtures';
const TRIVY_MUST_LIST = ['vitest', 'eslint', 'typescript'];
const SEMGREP_ARGS = [
    'scan',
    '--config',
    'p/typescript',
    '--config',
    'p/nodejsscan',
    '--config',
    'p/secrets',
    '--error',
    '--metrics',
    'off'
];
const PNPM_STORE_VOLUME = 'itrms-ci-pnpm-store';
const TRIVY_CACHE_VOLUME = 'itrms-ci-trivy-cache';

/**
 * The checks container gets the shape of a GitHub runner (4 cores, which also caps Vitest's workers, sized from the
 * visible CPUs) and a memory cap, so a local run behaves like the hosted one and leaves room for the dev stack. An
 * overrun fails a step visibly instead of starving the rest of the Docker VM.
 */
export const CHECKS_LIMITS = ['--cpuset-cpus', '0-3', '--memory', '6g', '--memory-swap', '6g'];

/** Pinned images that ci.yml itself names (one source of truth for their versions). */
export function pinnedImages(yml) {
    // one fixed pattern and a plain prefix match: an image name in a RegExp would need escaping (its dots match anything)
    const refs = yml.match(/[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}/g) ?? [];
    const find = (name, required = true) => {
        const ref = refs.find((r) => r.startsWith(`${name}:`));
        if (!ref && required) throw new Error(`ci.yml no longer pins ${name}`);
        return ref;
    };
    return {
        gitleaks: find('zricethezav/gitleaks'),
        semgrep: find('semgrep/semgrep'),
        // the stories job's container (from task 0.4a; older commits have none)
        playwright: find('mcr.microsoft.com/playwright', false)
    };
}

/** The `run:` commands of one job in ci.yml, in order (the workflow is plain enough for a line scan). */
export function jobRuns(yml, job) {
    const lines = yml.split(/\r?\n/);
    const start = lines.findIndex((l) => l === `  ${job}:`);
    if (start < 0) throw new Error(`ci.yml has no job ${job}`);
    const runs = [];
    for (const line of lines.slice(start + 1)) {
        if (/^ {2}\S/.test(line)) break; // the next job
        const m = /^\s+(?:- )?run: (.+)$/.exec(line);
        if (m) runs.push(m[1].trim());
    }
    return runs;
}

/** The checks job, step for step: the same commands as ci.yml (checked against the tested commit's ci.yml). */
export const CHECK_STEPS = [
    'pnpm install --frozen-lockfile',
    'pnpm check:slices',
    'pnpm boundaries',
    'pnpm i18n:check',
    'pnpm test:tools',
    'pnpm format:check',
    'pnpm turbo run lint typecheck test build --concurrency=3',
    'pnpm audit --audit-level high'
];

/** The stories job (task 0.4a): every story with axe in every theme and density, then the visual baselines. */
export const STORIES_STEPS = [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @itrms/ui build-storybook',
    'pnpm --filter @itrms/ui test:stories',
    'pnpm --filter @itrms/ui test:visual'
];

export const ALL_JOBS = ['checks', 'stories', 'infra', 'gitleaks', 'trivy', 'semgrep'];

/** The jobs a complete record of this commit needs: the stories job only once the commit's ci.yml has one. */
export const jobsFor = (yml) => ALL_JOBS.filter((j) => j !== 'stories' || yml.split(/\r?\n/).includes('  stories:'));

const git = (...args) => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
    return r.stdout.trim();
};
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

/**
 * The repository's shared git directory. A worktree's `.git` is only a file pointing at a host path, which doesn't exist
 * inside a container, so containers get this directory: the commit's objects, and none of the working tree's files
 * (infra/compose/.env and other untracked secrets stay out of the containers).
 */
const gitCommonDir = () => git('rev-parse', '--path-format=absolute', '--git-common-dir');

/**
 * Runs one command, streaming its output to the job log; resolves with the exit code and duration. With `capture`, the
 * output is also returned (as `output`, never written to the report) so a job can check what the tool really did.
 */
function run(log, label, cmd, args, opts = {}) {
    const { capture = false, ...spawnOpts } = opts;
    const started = Date.now();
    let output = '';
    log.write(`\n$ ${label}\n`);
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: ROOT, ...spawnOpts });
        const onData = (d) => {
            log.write(d);
            if (capture) output += d;
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (e) => {
            log.write(`${e.message}\n`);
            resolve({ label, code: 127, seconds: (Date.now() - started) / 1000, output });
        });
        child.on('close', (code) =>
            resolve({ label, code: code ?? 1, seconds: (Date.now() - started) / 1000, output })
        );
    });
}

/** gitleaks exits 0 when git fails and nothing is scanned. A pass needs at least one scanned commit and no error lines. */
export function gitleaksVerdict(output, code) {
    const scanned = Number(/(\d+) commits? scanned/.exec(output)?.[1] ?? 0);
    if (code !== 0) return { code, note: 'leaks or errors' };
    if (output.split('\n').some((line) => line.includes(' ERR ')))
        return { code: 1, note: 'git errors, so nothing reliable was scanned' };
    if (scanned === 0) return { code: 1, note: '0 commits scanned' };
    return { code: 0, note: `${scanned} commit(s) scanned` };
}

/**
 * The commits gitleaks scans. Not yet on origin/main: those commits. Already there (a merged commit, where that range is
 * empty), or --full-history: everything reachable from the commit. `-m` shows merge commits' changes too.
 */
export function gitleaksRange(sha, unpushed, fullHistory) {
    return fullHistory || unpushed === 0 ? `-m ${sha}` : `-m origin/main..${sha}`;
}

/** x.y.z with digits only: values that end up in a container's bash script. */
export function isVersion(v) {
    const parts = v.split('.');
    return parts.length === 3 && parts.every((p) => p.length > 0 && [...p].every((c) => c >= '0' && c <= '9'));
}

export function isPnpmVersion(spec) {
    const [name, version, ...rest] = spec.split('@');
    return name === 'pnpm' && rest.length === 0 && isVersion(version ?? '');
}

/** The clean source of the commit on disk (no node_modules), for the scanners. */
function exportTree(sha, dir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', 'src.tar');
    git('archive', '--format=tar', '-o', tar, sha);
    // Relative paths: GNU tar (Git for Windows) reads "C:…" as a remote host.
    const r = spawnSync('tar', ['-xf', 'src.tar', '-C', 'src'], { cwd: join(dir, '..') });
    rmSync(tar, { force: true });
    if (r.status !== 0) throw new Error('could not unpack the commit');
}

const bind = (source, target, ro = true) => [
    '--mount',
    `type=bind,source=${source},target=${target}${ro ? ',readonly' : ''}`
];

const JOBS = {
    async checks({ sha, log, inputs }) {
        const script = [
            'set -e',
            "git config --global safe.directory '*'",
            'git clone -q /repo.git /work && cd /work',
            `git checkout -q --detach ${sha}`,
            `npm install -g --silent ${inputs.pnpm}`,
            'pnpm config set store-dir /pnpm-store',
            ...CHECK_STEPS.map((s) => `echo "::step::${s}" && ${s}`),
            'echo "::step::pnpm licences:report (not a gate)" && (pnpm licences:report /dev/null || true)'
        ].join('\n');
        return [
            await run(
                log,
                `docker run ${inputs.nodeImage} (clone ${sha.slice(0, 12)}, ${CHECK_STEPS.length} steps)`,
                'docker',
                [
                    'run',
                    '--rm',
                    ...CHECKS_LIMITS,
                    ...bind(gitCommonDir(), '/repo.git'),
                    '--mount',
                    `type=volume,source=${PNPM_STORE_VOLUME},target=/pnpm-store`,
                    '-e',
                    'LEFTHOOK=0',
                    '-e',
                    'CI=true',
                    inputs.nodeImage,
                    'bash',
                    '-c',
                    script
                ]
            )
        ];
    },

    /**
     * In the pinned Playwright image (Chromium and its system libraries, the fonts come from the repository), with the
     * commit's Node version. With --update-visual it writes new baselines and copies them into the working tree.
     */
    async stories({ sha, log, images, inputs, out, updateVisual }) {
        if (!images.playwright)
            return [{ label: 'skipped: ci.yml pins no Playwright image', code: 0, seconds: 0, skipped: true }];
        const visual = updateVisual
            ? // no "--": pnpm would pass it on, and Playwright would read the flag as a test filter
              // the old baselines go first, so a renamed or removed story leaves no stale picture behind
              'rm -rf packages/ui/visual/__screenshots__ && pnpm --filter @itrms/ui test:visual --update-snapshots=all && rm -rf /out/screenshots && cp -r packages/ui/visual/__screenshots__ /out/screenshots'
            : STORIES_STEPS.at(-1);
        const steps = [...STORIES_STEPS.slice(0, -1), visual];
        const script = [
            'set -eo pipefail',
            // the image's Node may differ from .nvmrc: use the commit's version, as setup-node does on GitHub, checked
            // against the release's SHASUMS256.txt before it is unpacked
            `want=v${inputs.node}`,
            'if [ "$(node --version)" != "$want" ]; then',
            '  tarball="node-$want-linux-x64.tar.gz"', // .gz: no xz in the image
            '  curl -fsSL -o "/tmp/$tarball" "https://nodejs.org/dist/$want/$tarball"',
            '  curl -fsSL "https://nodejs.org/dist/$want/SHASUMS256.txt" | grep "  $tarball\\$" | (cd /tmp && sha256sum -c -)',
            '  tar -xzf "/tmp/$tarball" -C /opt',
            '  export PATH="/opt/node-$want-linux-x64/bin:$PATH"',
            'fi',
            "git config --global safe.directory '*'",
            'git clone -q /repo.git /work && cd /work',
            `git checkout -q --detach ${sha}`,
            `npm install -g --silent ${inputs.pnpm}`,
            'pnpm config set store-dir /pnpm-store',
            ...steps.map((s) => `echo "::step::${s}" && ${s}`)
        ].join('\n');
        const result = await run(
            log,
            `docker run ${images.playwright} (clone ${sha.slice(0, 12)}, ${steps.length} steps)`,
            'docker',
            [
                'run',
                '--rm',
                '--ipc=host', // Chromium needs more shared memory than Docker's default
                ...CHECKS_LIMITS,
                ...bind(gitCommonDir(), '/repo.git'),
                ...bind(out, '/out', false),
                '--mount',
                `type=volume,source=${PNPM_STORE_VOLUME},target=/pnpm-store`,
                '-e',
                'LEFTHOOK=0',
                '-e',
                'CI=true',
                images.playwright,
                'bash',
                '-c',
                script
            ]
        );
        if (updateVisual && result.code === 0) {
            const target = join(ROOT, 'packages', 'ui', 'visual', '__screenshots__');
            rmSync(target, { recursive: true, force: true });
            cpSync(join(out, 'screenshots'), target, { recursive: true });
            log.write(`\nbaselines copied to ${target}\n`);
        }
        return [result];
    },

    async infra({ log, isHeadClean }) {
        if (!isHeadClean) return [{ label: 'skipped: --ref is not a clean HEAD', code: 0, seconds: 0, skipped: true }];
        const steps = [];
        for (const s of ['pnpm dev:infra --observability', 'pnpm dev:infra:check', 'pnpm test:int']) {
            const r = await run(log, s, s, [], { shell: true });
            steps.push(r);
            if (r.code !== 0) break;
        }
        return steps;
    },

    async gitleaks({ sha, log, images, out, fullHistory }) {
        const unpushed = Number(git('rev-list', '--count', `origin/main..${sha}`));
        const range = gitleaksRange(sha, unpushed, fullHistory);
        // The container sees only .git, so the commit's own .gitleaksignore (verified findings) is mounted beside it.
        const ignore = join(out, 'gitleaksignore');
        const ignoreText = spawnSync('git', ['show', `${sha}:.gitleaksignore`], { cwd: ROOT, encoding: 'utf8' });
        writeFileSync(ignore, ignoreText.status === 0 ? ignoreText.stdout : '');
        const scan = await run(
            log,
            `gitleaks (${range})`,
            'docker',
            [
                'run',
                '--rm',
                ...bind(gitCommonDir(), '/repo/.git'),
                ...bind(ignore, '/repo/.gitleaksignore'),
                '-e',
                'GIT_CONFIG_COUNT=1',
                '-e',
                'GIT_CONFIG_KEY_0=safe.directory',
                '-e',
                'GIT_CONFIG_VALUE_0=*',
                images.gitleaks,
                'git',
                '/repo',
                '--redact',
                '--no-banner',
                `--log-opts=${range}`
            ],
            { capture: true }
        );
        const verdict = gitleaksVerdict(scan.output, scan.code);
        return [{ label: `${scan.label}: ${verdict.note}`, code: verdict.code, seconds: scan.seconds }];
    },

    async trivy({ src, out, log }) {
        const scan = await run(log, 'trivy fs', 'docker', [
            'run',
            '--rm',
            ...bind(src, '/src'),
            ...bind(out, '/out', false),
            '--mount',
            `type=volume,source=${TRIVY_CACHE_VOLUME},target=/root/.cache/trivy`,
            TRIVY_IMAGE,
            'fs',
            '--scanners',
            'vuln,secret,misconfig',
            '--severity',
            'HIGH,CRITICAL',
            '--ignore-unfixed',
            '--exit-code',
            '1',
            '--skip-dirs',
            TRIVY_SKIP_DIRS.split(',')
                .map((d) => `/src/${d}`)
                .join(','),
            '--list-all-pkgs',
            '--format',
            'json',
            '--output',
            '/out/trivy.json',
            '/src'
        ]);
        // The commit's own summary script, so an old commit is judged by its own rules.
        const script = join(src, 'tools', 'ci', 'trivy-summary.mjs');
        const summary = await run(log, 'trivy summary and coverage', process.execPath, [
            existsSync(script) ? script : join(ROOT, 'tools', 'ci', 'trivy-summary.mjs'),
            join(out, 'trivy.json'),
            ...TRIVY_MUST_LIST
        ]);
        return [scan, summary];
    },

    async semgrep({ src, log, images }) {
        return [
            await run(log, 'semgrep', 'docker', [
                'run',
                '--rm',
                ...bind(src, '/src'),
                '-w',
                '/src',
                images.semgrep,
                'semgrep',
                ...SEMGREP_ARGS
            ])
        ];
    }
};

function parseArgs(argv) {
    const opts = { ref: 'HEAD', jobs: null, fullHistory: false, updateVisual: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--ref') opts.ref = argv[++i];
        else if (argv[i] === '--jobs') opts.jobs = argv[++i].split(',');
        else if (argv[i] === '--full-history') opts.fullHistory = true;
        else if (argv[i] === '--update-visual') opts.updateVisual = true;
        else throw new Error(`unknown option ${argv[i]}`);
    }
    const unknown = (opts.jobs ?? []).filter((j) => !ALL_JOBS.includes(j));
    if (unknown.length) throw new Error(`unknown job(s) ${unknown.join(', ')}; jobs: ${ALL_JOBS.join(', ')}`);
    return opts;
}

/**
 * The verdict of a run. Complete only when every job ran and none was skipped; a partial run can pass its gates but is
 * never the commit's CI record (ADR-0034).
 */
export function summarise(jobs, expected = ALL_JOBS) {
    const ran = new Set(jobs.filter((j) => !j.skipped).map((j) => j.name));
    const missing = expected.filter((j) => !ran.has(j));
    const passed = jobs.every((j) => j.skipped || j.ok);
    return { complete: missing.length === 0, missing, passed, ok: missing.length === 0 && passed };
}

export function renderReport(r) {
    const mark = (j) => (j.skipped ? '–' : j.ok ? '✓' : '✗');
    const lines = [
        `# Local Linux CI: ${r.sha.slice(0, 12)}${r.complete ? '' : ' (partial: not a CI record)'}`,
        '',
        `* Commit: \`${r.sha}\` (${r.subject})`,
        `* Run: ${r.started} → ${r.finished} (${r.seconds.toFixed(0)} s)`,
        `* Engine: Docker ${r.engine.version} on ${r.engine.os} (${r.engine.kernel})`,
        `* Tool: ci-local from \`${r.tool.commit.slice(0, 12)}\`${r.tool.dirty ? ' (working tree had uncommitted changes)' : ''}`,
        `* Images: ${Object.entries(r.images)
            .map(([k, v]) => `${k} \`${v}\``)
            .join(', ')}`,
        '',
        '| Job | Result | Steps |',
        '|---|---|---|',
        ...r.jobs.map(
            (j) =>
                `| ${j.name} | ${mark(j)} | ${j.steps.map((s) => `${s.label}: ${s.skipped ? 'skipped' : s.code === 0 ? 'ok' : `exit ${s.code}`} (${s.seconds.toFixed(0)} s)`).join('<br>')} |`
        ),
        '',
        `Evidence: ${r.evidence}`,
        ''
    ];
    return lines.join('\n');
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const sha = git('rev-parse', '--verify', `${opts.ref}^{commit}`);
    const dirty = git('status', '--porcelain') !== '';
    const isHeadClean = sha === git('rev-parse', 'HEAD') && !dirty;

    // How the commit is tested comes from the commit itself.
    const atCommit = (path) => git('show', `${sha}:${path}`);
    const yml = atCommit('.github/workflows/ci.yml');
    const images = pinnedImages(yml);
    const missingSteps = CHECK_STEPS.filter((s) => !jobRuns(yml, 'checks').includes(s));
    if (missingSteps.length)
        throw new Error(
            `the commit's ci.yml checks job differs from this tool's steps (${missingSteps.join('; ')}); use the tool from that commit`
        );
    const expected = jobsFor(yml);
    const jobs = opts.jobs ?? expected;
    if (jobs.includes('stories') && !expected.includes('stories'))
        throw new Error("the commit's ci.yml has no stories job");
    if (expected.includes('stories')) {
        const missingStories = STORIES_STEPS.filter((s) => !jobRuns(yml, 'stories').includes(s));
        if (missingStories.length)
            throw new Error(
                `the commit's ci.yml stories job differs from this tool's steps (${missingStories.join('; ')})`
            );
    }
    if (opts.updateVisual && !jobs.includes('stories')) throw new Error('--update-visual needs the stories job');
    // the new baselines are copied into this working tree: they must be the pictures of the commit checked out here
    if (opts.updateVisual && sha !== git('rev-parse', 'HEAD'))
        throw new Error('--update-visual works on HEAD only (the baselines are copied into the working tree)');
    const node = atCommit('.nvmrc').trim();
    if (!isVersion(node)) throw new Error(`unexpected .nvmrc ${node}`);
    const inputs = {
        node,
        nodeImage: `node:${node}-bookworm`,
        pnpm: JSON.parse(atCommit('package.json')).packageManager.replace(/\+.*$/, '')
    };
    // It ends up in a bash script: only pnpm@<digits>.<digits>.<digits> is accepted.
    if (!isPnpmVersion(inputs.pnpm)) throw new Error(`unexpected packageManager ${inputs.pnpm}`);

    const info = docker(
        'version',
        '--format',
        '{{.Server.Version}}|{{.Server.Os}}/{{.Server.Arch}}|{{.Server.KernelVersion}}'
    );
    if (info.status !== 0) throw new Error('Docker is not running (start Docker Desktop / the WSL2 engine)');
    const [version, os, kernel] = info.stdout.trim().split('|');

    const out = join(ROOT, '.ci-local', sha.slice(0, 12));
    const src = join(out, 'src');
    mkdirSync(join(out, 'logs'), { recursive: true });
    if (jobs.some((j) => j === 'trivy' || j === 'semgrep')) exportTree(sha, src);

    const started = new Date();
    const report = {
        sha,
        subject: git('log', '-1', '--format=%s', sha),
        started: started.toISOString(),
        engine: { version, os, kernel },
        tool: { commit: git('rev-parse', 'HEAD'), dirty },
        images: { node: inputs.nodeImage, ...images, trivy: TRIVY_IMAGE },
        jobs: []
    };
    for (const name of jobs) {
        const log = createWriteStream(join(out, 'logs', `${name}.log`));
        process.stdout.write(`${name} … `);
        const steps = await JOBS[name]({
            sha,
            log,
            images,
            inputs,
            src,
            out,
            isHeadClean,
            fullHistory: opts.fullHistory,
            updateVisual: opts.updateVisual
        });
        await new Promise((r) => log.end(r));
        const skipped = steps.every((s) => s.skipped);
        const ok = !skipped && steps.every((s) => s.code === 0);
        report.jobs.push({ name, ok, skipped, steps: steps.map(({ output: _output, ...step }) => step) });
        console.log(skipped ? 'skipped' : ok ? 'ok' : `FAILED (see .ci-local/${sha.slice(0, 12)}/logs/${name}.log)`);
    }
    const nodeDigest = docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', report.images.node);
    if (nodeDigest.status === 0) report.images.node = nodeDigest.stdout.trim();

    const finished = new Date();
    const verdict = summarise(report.jobs, expected);
    // A run that rewrote the baselines compared nothing: it is never a CI record.
    if (opts.updateVisual)
        Object.assign(verdict, {
            complete: false,
            ok: false,
            missing: [...verdict.missing, 'visual comparison (baselines updated)']
        });
    Object.assign(report, { finished: finished.toISOString(), seconds: (finished - started) / 1000, ...verdict });
    report.evidence =
        `ci:local ${sha.slice(0, 7)} on Linux (Docker ${version})${verdict.complete ? '' : ` PARTIAL (not run: ${verdict.missing.join(', ')})`}: ` +
        report.jobs.map((j) => `${j.name} ${j.skipped ? 'skipped' : j.ok ? 'pass' : 'FAIL'}`).join(', ');
    const name = verdict.complete ? 'report' : 'report-partial';
    writeFileSync(join(out, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, `${name}.md`), renderReport(report));
    rmSync(src, { recursive: true, force: true });
    console.log(`\n${report.evidence}\nReport: .ci-local/${sha.slice(0, 12)}/${name}.md`);
    process.exitCode = verdict.passed ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
    });
}
