#!/usr/bin/env node
// Progress CLI (no dependencies). Used by the project skills, hooks and status line.
//
//   node tools/progress/cli.mjs summary                       session summary (SessionStart hook, /task-status)
//   node tools/progress/cli.mjs line                          one-line status (status line)
//   node tools/progress/cli.mjs show 0.2                      one task as JSON
//   node tools/progress/cli.mjs set 0.2 "in progress" --branch task/0.2-monorepo
//   node tools/progress/cli.mjs set 0.2 "in review" --commit abc123 --evidence "pnpm test → 412 passed"
//   node tools/progress/cli.mjs set 0.2 blocked --blocker "waiting for X"
//   node tools/progress/cli.mjs set 0.1 done --approved       only after the product owner approved the task
//   node tools/progress/cli.mjs note 0.2 "text"               add a note
//   node tools/progress/cli.mjs followup 0.2 "item" "moved to"
//   node tools/progress/cli.mjs followup-done 3 "0.4: env-based fixtures"   close follow-up number 3
//   node tools/progress/cli.mjs render                        regenerate docs/engineering/progress.md
//   node tools/progress/cli.mjs report                        phase report (Markdown) to stdout
//   node tools/progress/cli.mjs export <dir>                  dashboard row files (tasks, phases, followups .json)
import {
    load,
    save,
    findTask,
    setStatus,
    phaseStats,
    currentPhase,
    focusTask,
    gitBranch,
    bar,
    allTasks
} from './lib.mjs';
import { render } from './render.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);

function flags(list) {
    const out = { _: [] };
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            const v = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
            (out[k] ??= []).push(v);
        } else out._.push(a);
    }
    return out;
}

function summary(data) {
    const p = currentPhase(data);
    const s = phaseStats(p);
    const f = focusTask(data);
    const lines = [
        `ITRMS progress: Phase ${p.id} (${p.title}) ${s.done}/${s.total} done (${s.pct}%) ${bar(s.pct)}`,
        `  ready ${s.counts.ready} · in progress ${s.counts['in progress']} · in review ${s.counts['in review']} · blocked ${s.counts.blocked} · planned ${s.counts.planned}`,
        `  Gate: ${p.gate}`
    ];
    if (f)
        lines.push(
            `Focus: ${f.id} ${f.title} [${f.status}]${f.branch ? ` on ${f.branch}` : ''}${f.blockers?.length ? ` · blockers: ${f.blockers.join('; ')}` : ''}`
        );
    const review = allTasks(data).filter((t) => t.status === 'in review');
    if (review.length) lines.push(`Waiting for the product owner's approval: ${review.map((t) => t.id).join(', ')}`);
    const next = allTasks(data).find((t) => t.status === 'ready');
    if (next && next.id !== f?.id) lines.push(`Next ready: ${next.id} ${next.title}`);
    lines.push(`Open follow-ups: ${data.followUps.filter((f) => !f.closedIn).length} · branch: ${gitBranch() || '?'}`);
    lines.push(
        'Rules: one task at a time; definition of ready/done in docs/engineering/workflow.md; update progress with tools/progress/cli.mjs.'
    );
    return lines.join('\n');
}

function line(data) {
    const p = currentPhase(data);
    const s = phaseStats(p);
    const f = focusTask(data);
    const branch = gitBranch();
    return `ITRMS · P${p.id} ${s.done}/${s.total} ${bar(s.pct, 8)}${f ? ` · ${f.id} ${f.status}` : ''}${branch ? ` · ⎇ ${branch}` : ''}`;
}

function report(data) {
    const out = [`# ITRMS progress report (${data.updated})`, ''];
    for (const p of data.phases) {
        const s = phaseStats(p);
        out.push(`## Phase ${p.id}: ${p.title} — ${s.done}/${s.total} done (${s.pct}%)`);
        out.push(`Gate: ${p.gate}`, '');
        const active = p.tasks.filter((t) => t.status !== 'planned');
        if (active.length) {
            out.push('| Task | Title | Status | Branch / commits |', '|---|---|---|---|');
            for (const t of active)
                out.push(
                    `| ${t.id} | ${t.title} | ${t.status} | ${[t.branch, ...t.commits].filter(Boolean).join(', ')} |`
                );
        } else out.push('_No task started._');
        out.push('');
    }
    out.push(`Open follow-ups: ${data.followUps.filter((f) => !f.closedIn).length}`);
    return out.join('\n');
}

// Flat row files for the progress dashboard (docs/engineering/dashboard.md).
function exportRows(data) {
    const phases = data.phases.map((p) => {
        const s = phaseStats(p);
        return {
            phase: p.id,
            title: p.title,
            gate: p.gate,
            total: s.total,
            done: s.done,
            pct: s.pct,
            in_review: s.counts['in review'],
            in_progress: s.counts['in progress'],
            blocked: s.counts.blocked,
            ready: s.counts.ready,
            planned: s.counts.planned
        };
    });
    const tasks = allTasks(data).map((t) => ({
        task: t.id,
        phase: t.phase,
        title: t.title,
        status: t.status,
        branch: t.branch ?? '',
        commits: t.commits.join(', '),
        evidence: t.evidence.length,
        blockers: t.blockers.join('; '),
        notes: t.notes ?? ''
    }));
    const followups = data.followUps.map((f, i) => ({
        n: i + 1,
        found_in: f.foundIn,
        item: f.item,
        moved_to: f.movedTo,
        closed_in: f.closedIn ?? ''
    }));
    return { tasks, phases, followups };
}

try {
    const data = load();
    switch (cmd) {
        case 'summary':
            console.log(summary(data));
            break;
        case 'line':
            process.stdout.write(line(data));
            break;
        case 'show':
            console.log(JSON.stringify(findTask(data, args[0]), null, 2));
            break;
        case 'set': {
            const f = flags(args);
            const [id, status] = f._;
            const t = setStatus(data, id, status, { approved: !!f.approved });
            if (f.branch) t.branch = f.branch.at(-1);
            for (const c of f.commit ?? []) t.commits.push(c);
            for (const e of f.evidence ?? []) t.evidence.push(e);
            if (status === 'blocked') t.blockers.push(...(f.blocker ?? ['(reason not given)']));
            else if (f.blocker) t.blockers.push(...f.blocker);
            if (status !== 'blocked' && f['clear-blockers']) t.blockers = [];
            save(data);
            render();
            console.log(`${id} → ${t.status}`);
            break;
        }
        case 'note': {
            const t = findTask(data, args[0]);
            t.notes = [t.notes, args.slice(1).join(' ')].filter(Boolean).join(' ');
            save(data);
            render();
            break;
        }
        case 'followup':
            data.followUps.push({ foundIn: args[0], item: args[1], movedTo: args[2] ?? '' });
            save(data);
            render();
            break;
        case 'followup-done': {
            const f = data.followUps[Number(args[0]) - 1];
            if (!f || !args[1]) throw new Error('Usage: followup-done <number> "<task and how it was closed>"');
            f.closedIn = args[1];
            save(data);
            render();
            console.log(`follow-up ${args[0]} closed: ${args[1]}`);
            break;
        }
        case 'render':
            render();
            console.log('docs/engineering/progress.md regenerated');
            break;
        case 'report':
            console.log(report(data));
            break;
        case 'export': {
            const dir = args[0];
            if (!dir) throw new Error('Usage: export <dir>');
            for (const [name, rows] of Object.entries(exportRows(data)))
                writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows, null, 2) + '\n', 'utf8');
            console.log(`tasks.json, phases.json, followups.json written to ${dir}`);
            break;
        }
        default:
            console.error(
                'Usage: node tools/progress/cli.mjs summary|line|show|set|note|followup|followup-done|render|report|export (see the header of this file)'
            );
            process.exit(1);
    }
} catch (e) {
    console.error(`progress: ${e.message}`);
    process.exit(1);
}
