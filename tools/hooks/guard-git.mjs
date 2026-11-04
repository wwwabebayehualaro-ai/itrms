#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell): git guardrails (docs/engineering/workflow.md §5).
// Denies commands that bypass checks or destroy history; a push to origin goes ahead, a push elsewhere asks.
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
        [
            /\sgit\s+(-c\s+\S+\s+)*push\b[^|;&]*\s(--force\b|-f\b|--force-with-lease\b|\+\S)/,
            'Force-push rewrites shared history. Ask the product owner; it is never done by a session.'
        ],
        [
            /\sgit\s+(-c\s+\S+\s+)*reset\b[^|;&]*\s--hard\b/,
            'git reset --hard discards work. Use git stash or a new commit; destructive resets need the product owner.'
        ],
        [
            /\sgit\s+(-c\s+\S+\s+)*clean\b[^|;&]*\s-[a-zA-Z]*f/,
            'git clean -f deletes untracked files permanently. Ask the product owner first.'
        ],
        [
            /\s(git\s+filter-repo|git\s+filter-branch|git-filter-repo)\b/,
            'Rewriting repository history is a product-owner decision (see the follow-up in progress.json).'
        ]
    ];
    for (const [re, reason] of deny) if (re.test(c)) return { kind: 'deny', reason };
    const pushes = [...c.matchAll(/\sgit\s+(-c\s+\S+\s+)*push\b([^|;&]*)/g)];
    if (pushes.length > 0) {
        // The product owner lets sessions push to origin without asking (2026-11-04). Another remote still asks
        // (origin is the one repo in use), and so does a push this reading can't be sure of.
        const toOrigin = pushes.every(({ 2: rest = '' }) => {
            const words = rest.trim().split(' ').filter(Boolean);
            const remote = words.find((word) => !word.startsWith('-'));
            const known = words.every((word) => !word.startsWith('-') || /^(-u|--set-upstream)$/.test(word));
            return known && (remote === undefined || remote === 'origin');
        });
        if (!toOrigin)
            return {
                kind: 'ask',
                reason: 'This pushes somewhere other than origin, or in a way the guard cannot read.'
            };
        // only a push on its own is approved here: an approval would cover everything else in a longer command, which the
        // normal permission flow decides
        const alone = !/[|;&`$<>\n]/.test(cmd);
        return alone ? { kind: 'allow', reason: 'Pushing to origin is allowed (product owner, 2026-11-04).' } : null;
    }
    return null;
}
