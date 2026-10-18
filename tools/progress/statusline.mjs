#!/usr/bin/env node
// Claude Code status line: phase progress, focus task and branch. Claude Code passes session JSON on stdin; it is not needed.
import { load, phaseStats, currentPhase, focusTask, gitBranch, bar } from './lib.mjs';

try {
    const data = load();
    const p = currentPhase(data);
    const s = phaseStats(p);
    const f = focusTask(data);
    const branch = gitBranch();
    process.stdout.write(
        `ITRMS · Phase ${p.id} ${s.done}/${s.total} ${bar(s.pct, 8)} ${s.pct}%${f ? ` · ${f.id} ${f.status}` : ''}${branch ? ` · ⎇ ${branch}` : ''}`
    );
} catch {
    process.stdout.write('ITRMS · progress unavailable');
}
