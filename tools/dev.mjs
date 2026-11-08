// `pnpm dev`: the app on the development stack. It starts the API (:4000), the worker, the documents worker and the web app
// (:3000) with each line prefixed by its process, and stops them all together (Ctrl+C, or when one of them exits). It needs
// the stack up and its settings written (`pnpm dev:infra`) and the API built (`pnpm --filter @itrms/api build`); the web
// app runs as `next dev`, so its changes reload by themselves. `--no-workers` starts the API and the web app only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps', 'api');
const WEB = join(ROOT, 'apps', 'web');

/** The processes `pnpm dev` runs: name, working folder, node arguments. */
export function devProcesses({ workers = true, nextBin = 'next' } = {}) {
    const api = (env, script, ...flags) => [
        '--env-file=' + env,
        '--enable-source-maps',
        ...flags,
        join('dist', script)
    ];
    return [
        { name: 'api', cwd: API, args: api('.env.http.local', 'main.cjs') },
        ...(workers
            ? [
                  { name: 'worker', cwd: API, args: api('.env.worker.local', 'worker.cjs') },
                  {
                      name: 'docs',
                      cwd: API,
                      args: api('.env.worker.local', 'worker-documents.cjs', '--max-old-space-size=512')
                  }
              ]
            : []),
        { name: 'web', cwd: WEB, args: [nextBin, 'dev', '-p', '3000'] }
    ];
}

/** What is missing before anything starts, in the words of the command that fixes it. */
export function missing(exists = existsSync) {
    const problems = [];
    if (!exists(join(API, 'dist', 'main.cjs'))) problems.push('the API is not built: pnpm --filter @itrms/api build');
    for (const file of [join(API, '.env.http.local'), join(API, '.env.worker.local'), join(WEB, '.env.local')])
        if (!exists(file)) problems.push(`${file} is missing: pnpm dev:infra writes it`);
    return problems;
}

const main = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (main) {
    const problems = missing();
    if (problems.length) {
        for (const p of problems) console.error(`pnpm dev: ${p}`);
        process.exit(1);
    }
    const nextBin = createRequire(join(WEB, 'package.json')).resolve('next/dist/bin/next');
    const processes = devProcesses({ workers: !process.argv.includes('--no-workers'), nextBin });
    const width = Math.max(...processes.map((p) => p.name.length));
    const children = [];
    let stopping = false;
    const stop = (code) => {
        if (stopping) return;
        stopping = true;
        for (const child of children) if (child.exitCode === null) child.kill();
        process.exitCode = code;
    };
    for (const p of processes) {
        const child = spawn(process.execPath, p.args, { cwd: p.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        children.push(child);
        const label = `${p.name.padEnd(width)} │ `;
        for (const stream of [child.stdout, child.stderr])
            createInterface({ input: stream }).on('line', (line) => process.stdout.write(label + line + '\n'));
        child.on('exit', (code, signal) => {
            if (!stopping) console.error(`${label}stopped (${signal ?? code}): stopping the others`);
            stop(code || 1);
        });
    }
    process.on('SIGINT', () => stop(0));
    process.on('SIGTERM', () => stop(0));
    console.log(
        `pnpm dev: ${processes.map((p) => p.name).join(', ')} · web http://localhost:3000 · api http://localhost:4000`
    );
}
