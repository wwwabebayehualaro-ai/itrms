#!/usr/bin/env node
// Stop hook: when a task is "in progress" and the working tree has changes but progress.json was not updated, ask Claude
// (once per stop, never in a loop) to record the task's progress with tools/progress/cli.mjs before finishing.
import { execFileSync } from 'node:child_process';
import { load, allTasks, ROOT } from '../progress/lib.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
    try {
        const input = JSON.parse(raw || '{}');
        if (input.stop_hook_active) process.exit(0); // already reminded in this stop cycle: never loop

        const active = allTasks(load()).filter((t) => t.status === 'in progress');
        if (!active.length) process.exit(0);

        const status = execFileSync('git', ['status', '--porcelain'], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString();
        const changed = status
            .split('\n')
            .filter(Boolean)
            .map((l) => l.slice(3).replace(/^"|"$/g, ''));
        const progressTouched = changed.some((f) => f.startsWith('docs/engineering/progress.'));
        const work = changed.filter((f) => !f.startsWith('docs/engineering/progress.'));
        if (!work.length || progressTouched) process.exit(0);

        const t = active[0];
        process.stdout.write(
            JSON.stringify({
                decision: 'block',
                reason:
                    `Task ${t.id} (${t.title}) is in progress and ${work.length} file(s) changed, but progress.json was not updated. ` +
                    `Before finishing: record what was done with \`node tools/progress/cli.mjs note ${t.id} "..."\`, and if the task's ` +
                    `"Done when" items are demonstrated, move it with \`node tools/progress/cli.mjs set ${t.id} "in review" --commit <sha> --evidence "<command → result>"\` ` +
                    `(see docs/engineering/workflow.md §4). If nothing needs recording, say so and stop.`
            })
        );
    } catch {
        // never block a stop because the reminder itself failed
    }
    process.exit(0);
});
