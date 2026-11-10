/** The seed CLI's commands (`src/seed.ts`): which are known, and how one run lists several. */
const FILE_KINDS = ['org', 'users', 'services', 'fees', 'settings'];
const PLAIN_KINDS = ['identity', 'counters', 'documents', 'competency', 'vehicles', 'demo'];

/** `org a.yaml --then users b.yaml` is two commands, applied in order in one process. */
export function parseSeedCommands(argv: readonly string[]): string[][] {
    const commands: string[][] = [[]];
    for (const arg of argv) {
        if (arg === '--then') commands.push([]);
        else commands[commands.length - 1]?.push(arg);
    }
    return commands;
}

/** A known command, with the file it needs. */
export function isSeedCommand([kind, file]: readonly string[]): boolean {
    return kind !== undefined && (PLAIN_KINDS.includes(kind) || (FILE_KINDS.includes(kind) && file !== undefined));
}
