#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell): git guardrails (docs/engineering/workflow.md §5).
// Denies commands that bypass checks or destroy history; a plain push of a branch to origin goes ahead, any other asks.
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

// A push of a branch (or HEAD, or HEAD to a branch) to origin, with only the quiet and upstream flags; or the deletion of a
// merged branch on origin other than main.
const REF = '[A-Za-z0-9][A-Za-z0-9._/-]*';
const FLAGS = '( (-q|--quiet|-u|--set-upstream))*';
const SAFE_PUSH = new RegExp(
    `^git push${FLAGS} origin( (${REF}|HEAD:${REF}))?${FLAGS}$|^git push${FLAGS} origin (--delete |:)(?!main$)${REF}$`
);
// Pushes that could send the code somewhere else, or replace what origin holds: never done by a session.
const FOREIGN_PUSH = [
    /\sgit\s+(-[cC](\s+\S+)?\s+)*-c\s/,
    /\bGIT_[A-Z_]+=/,
    /\spush\b[^|;&]*\s--(mirror|all|repo(=|\s))/,
    /\spush\b[^|;&]*\s(https?:\/\/|ssh:\/\/|git@|file:\/\/|\.{0,2}\/)/
];

function decide(cmd) {
    const c = ` ${argsOnly(cmd).replace(/\s+/g, ' ')} `;
    const deny = [
        [/\s--no-verify\b/, 'Hooks and checks are never skipped (--no-verify). Fix the failing check instead.'],
        [
            /\sgit\s+(-[cC](\s+\S+)?\s+)*push\b[^|;&]*\s(--force\b|-f\b|--force-with-lease\b|\+\S)/,
            'Force-push rewrites shared history. Ask the product owner; it is never done by a session.'
        ],
        [
            /\sgit\s+(-[cC](\s+\S+)?\s+)*reset\b[^|;&]*\s--hard\b/,
            'git reset --hard discards work. Use git stash or a new commit; destructive resets need the product owner.'
        ],
        [
            /\sgit\s+(-[cC](\s+\S+)?\s+)*clean\b[^|;&]*\s-[a-zA-Z]*f/,
            'git clean -f deletes untracked files permanently. Ask the product owner first.'
        ],
        [
            /\s(git\s+filter-repo|git\s+filter-branch|git-filter-repo)\b/,
            'Rewriting repository history is a product-owner decision (see the follow-up in progress.json).'
        ]
    ];
    for (const [re, reason] of deny) if (re.test(c)) return { kind: 'deny', reason };
    if (/\sgit\s+(-[cC](\s+\S+)?\s+)*push\b/.test(c)) {
        // The product owner lets sessions push to origin without asking (2026-11-04), and wants no prompts at all
        // (2026-11-07): a push to origin goes ahead, one that could go elsewhere is denied, anything else is left to the
        // normal permission flow (auto mode). Nothing here asks.
        const flat = (text) => text.trim().replace(/\s+/g, ' ');
        const parts = argsOnly(cmd)
            .split(/&&|\|\||[;|&\n]/)
            .map(flat);
        const pushes = parts.filter((part) => /\bgit\b.*\bpush\b/.test(part));
        if (pushes.some((part) => FOREIGN_PUSH.some((re) => re.test(` ${part} `))) || /\sGIT_[A-Z_]+=/.test(c))
            return {
                kind: 'deny',
                reason: 'Only origin is pushed to, with git’s own settings; another remote, URL, mirror or override is not.'
            };
        if (pushes.some((part) => / origin (--delete |:)main\b/.test(part)))
            return { kind: 'deny', reason: 'main is never deleted on origin.' };
        const named = pushes.filter((part) => !/^git push( (-q|--quiet))*$/.test(part));
        if (named.some((part) => !/ origin\b/.test(part)))
            return { kind: 'deny', reason: 'Only origin is pushed to; name it (git push origin <branch>).' };
        if (SAFE_PUSH.test(flat(cmd)))
            return { kind: 'allow', reason: 'A push to origin (product owner, 2026-11-04).' };
        // in a longer command an approval here would cover the rest too: the normal permission flow decides
        return null;
    }
    return null;
}
