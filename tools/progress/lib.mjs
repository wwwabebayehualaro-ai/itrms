// Progress data: docs/engineering/progress.json is the single source of truth for task status (docs/engineering/workflow.md).
// The Markdown log, the status line, the session summary and the dashboard are all generated from it.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'docs', 'engineering', 'progress.json');

export const STATUSES = ['planned', 'ready', 'in progress', 'in review', 'done', 'blocked'];

// Allowed moves (workflow.md §1). `done` is reachable only with the product owner's approval (checked in setStatus).
const NEXT = {
    planned: ['ready', 'blocked'],
    ready: ['in progress', 'blocked', 'planned'],
    'in progress': ['in review', 'blocked'],
    'in review': ['done', 'in progress', 'blocked'],
    blocked: ['planned', 'ready', 'in progress', 'in review'],
    done: []
};

export function load() {
    return JSON.parse(readFileSync(DATA, 'utf8'));
}

export function save(data) {
    data.updated = new Date().toISOString().slice(0, 10);
    writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function allTasks(data) {
    return data.phases.flatMap((p) => p.tasks.map((t) => ({ ...t, phase: p.id })));
}

export function findTask(data, id) {
    for (const p of data.phases) {
        const t = p.tasks.find((x) => x.id === id);
        if (t) return t;
    }
    throw new Error(`Unknown task ${id}`);
}

export function setStatus(data, id, status, { approved = false } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Unknown status "${status}" (use: ${STATUSES.join(', ')})`);
    const t = findTask(data, id);
    if (t.status === status) return t;
    if (!NEXT[t.status].includes(status))
        throw new Error(
            `Task ${id}: "${t.status}" → "${status}" is not allowed (allowed: ${NEXT[t.status].join(', ') || 'none'})`
        );
    if (status === 'done' && !approved)
        throw new Error(
            `Task ${id}: only the product owner moves a task to done (pass --approved after their approval)`
        );
    if (status === 'in progress') {
        const busy = allTasks(data).filter((x) => x.id !== id && x.status === 'in progress');
        if (busy.length) throw new Error(`Task ${busy[0].id} is already in progress (one task at a time, CLAUDE.md)`);
    }
    t.status = status;
    return t;
}

export function phaseStats(phase) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const t of phase.tasks) counts[t.status]++;
    const total = phase.tasks.length;
    return { total, counts, done: counts.done, pct: total ? Math.round((counts.done / total) * 100) : 0 };
}

/** The phase being worked on: the first one with unfinished tasks. */
export function currentPhase(data) {
    return data.phases.find((p) => p.tasks.some((t) => t.status !== 'done')) ?? data.phases.at(-1);
}

/** The task that needs attention: in progress, else in review, else blocked, else the next ready/planned one. */
export function focusTask(data) {
    const tasks = allTasks(data);
    for (const s of ['in progress', 'in review', 'blocked', 'ready', 'planned']) {
        const t = tasks.find((x) => x.status === s);
        if (t) return t;
    }
    return null;
}

export function gitBranch() {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'ignore']
        })
            .toString()
            .trim();
    } catch {
        return '';
    }
}

export function bar(pct, width = 10) {
    const full = Math.round((pct / 100) * width);
    return '▰'.repeat(full) + '▱'.repeat(width - full);
}
