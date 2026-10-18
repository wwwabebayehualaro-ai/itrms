#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell): git guardrails (docs/engineering/workflow.md §5).
// Denies commands that bypass checks or destroy history; asks before anything is pushed to a remote.
// Input: hook JSON on stdin ({ tool_name, tool_input: { command } }). Output: a permission decision, or nothing.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
    let command = '';
    try {
        command = JSON.parse(raw || '{}')?.tool_input?.command ?? '';
    } catch {
        process.exit(0); // not our input: let the normal permission flow decide
    }
    const decision = decide(command);
    if (decision) {
        process.stdout.write(
            JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: decision.kind,
                    permissionDecisionReason: decision.reason
                }
            })
        );
    }
    process.exit(0);
});

// Text that is data, not arguments (heredoc bodies, here-strings, quoted messages), must not trigger a rule:
// a commit message may mention --no-verify. A quoted single token ('--no-verify') is still an argument, so it is kept.
function argsOnly(cmd) {
    return cmd
        .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, ' ')
        .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, ' ')
        .replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (m, a, b) => (/\s/.test(a ?? b) ? ' ' : (a ?? b)));
}

function decide(cmd) {
    const c = ` ${argsOnly(cmd).replace(/\s+/g, ' ')} `;
    const deny = [
        [/\s--no-verify\b/, 'Hooks and checks are never skipped (--no-verify). Fix the failing check instead.'],
        [/\sgit\s+(-c\s+\S+\s+)*push\b[^|;&]*\s(--force\b|-f\b|--force-with-lease\b|\+\S)/, 'Force-push rewrites shared history. Ask the product owner; it is never done by a session.'],
        [/\sgit\s+(-c\s+\S+\s+)*reset\b[^|;&]*\s--hard\b/, 'git reset --hard discards work. Use git stash or a new commit; destructive resets need the product owner.'],
        [/\sgit\s+(-c\s+\S+\s+)*clean\b[^|;&]*\s-[a-zA-Z]*f/, 'git clean -f deletes untracked files permanently. Ask the product owner first.'],
        [/\s(git\s+filter-repo|git\s+filter-branch|git-filter-repo)\b/, 'Rewriting repository history is a product-owner decision (see the follow-up in progress.json).']
    ];
    for (const [re, reason] of deny) if (re.test(c)) return { kind: 'deny', reason };
    if (/\sgit\s+(-c\s+\S+\s+)*push\b/.test(c)) {
        return { kind: 'ask', reason: 'Pushing sends code to GitHub (outward-facing). The product owner approves every push.' };
    }
    return null;
}
