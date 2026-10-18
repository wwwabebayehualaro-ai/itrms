// Regenerates docs/engineering/progress.md from progress.json. The Markdown file is generated: never edit it by hand.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, load, phaseStats } from './lib.mjs';

const esc = (s) =>
    String(s ?? '')
        .replaceAll('|', '\\|')
        .replaceAll('\n', ' ');

export function render() {
    const data = load();
    const out = [
        '# Progress log',
        '',
        '> **Generated** from [`progress.json`](progress.json) by `node tools/progress/cli.mjs render`. Do not edit by hand.',
        '> Update it with the CLI or the `/task-*` skills. Rules: [workflow.md](workflow.md). Statuses: planned, ready, in progress,',
        '> in review, done, blocked. Only the product owner moves a task to **done**.',
        '',
        `Last updated: ${data.updated}. Planning: ${data.planning.status} (${data.planning.evidence}).`,
        ''
    ];
    for (const p of data.phases) {
        const s = phaseStats(p);
        out.push(`## Phase ${p.id}: ${p.title} — ${s.done}/${s.total} done (${s.pct}%)`, '', `**Gate:** ${p.gate}`, '');
        out.push(
            '| Task | Title | Status | Branch / commits | Evidence | Notes / blockers |',
            '|---|---|---|---|---|---|'
        );
        for (const t of p.tasks) {
            const status = t.status === 'planned' ? 'planned' : `**${t.status}**`;
            const refs = [t.branch && `\`${t.branch}\``, ...t.commits].filter(Boolean).join(', ');
            const notes = [t.notes, ...(t.blockers ?? []).map((b) => `BLOCKED: ${b}`)].filter(Boolean).join(' ');
            out.push(
                `| ${t.id} | ${esc(t.title)} | ${status} | ${esc(refs)} | ${esc(t.evidence.join('; '))} | ${esc(notes)} |`
            );
        }
        out.push('');
    }
    out.push('## Follow-ups', '', '| # | Found in | Item | Moved to | Closed |', '|---|---|---|---|---|');
    data.followUps.forEach((f, i) =>
        out.push(
            `| ${i + 1} | ${esc(f.foundIn)} | ${esc(f.item)} | ${esc(f.movedTo)} | ${f.closedIn ? `✔ ${esc(f.closedIn)}` : 'open'} |`
        )
    );
    out.push('');
    writeFileSync(join(ROOT, 'docs', 'engineering', 'progress.md'), out.join('\n'), 'utf8');
}

if (process.argv[1]?.endsWith('render.mjs')) render();
